import {
  createQueue,
  createWorker,
  QueueNames,
  type Queue,
  type Redis,
  type Worker,
  type OutboundJob,
} from '@my-soso/queue';
import { schema, withServiceContext, type Database } from '@my-soso/db';
import { RateLimitedError, UnknownSymbolError, type MarketDataProvider } from '@my-soso/providers';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { withSentry } from '../sentry.js';
import {
  isInQuietHours,
  loadUserPreferencesBatch,
  recordAndCheckPushQuota,
  type BotPreferences,
} from '../preferences.js';

/**
 * Alert engine: a singleton repeatable BullMQ job that evaluates
 * every active alert against the warm cache and persists deliveries
 * with a dedup constraint, then enqueues outbound replies.
 *
 * Cost discipline: this engine NEVER calls the model. News alerts are
 * a SQL filter on news_extractions.affected_assets (populated by the
 * separate news-extractor that runs once per article). Price alerts
 * are a per-symbol cache hit followed by a JS comparison. So an alert
 * tick over 10k alerts costs roughly: distinct(symbols) cache lookups
 * + 10k integer comparisons + N rows of writes for the alerts that
 * actually fire.
 */

interface AlertTick {
  scheduledAt: number;
}

export interface AlertEngineOptions {
  connection: Redis;
  log: Logger;
  db: Database;
  market: MarketDataProvider;
  /** Tick cadence in ms. Default 60_000. */
  intervalMs?: number;
  /**
   * Cooldown between two consecutive fires of the same alert in ms.
   * Default 60 minutes — a sustained price cross does not spam the user.
   */
  cooldownMs?: number;
  /**
   * Lookback window for news alerts. Articles older than this are not
   * considered. Default 6 hours.
   */
  newsLookbackMs?: number;
}

export interface AlertEngineHandles {
  worker: Worker<AlertTick>;
  queue: Queue<AlertTick>;
  close: () => Promise<void>;
}

const REPEAT_KEY = 'alerts:evaluate';

export function startAlertEngine(opts: AlertEngineOptions): AlertEngineHandles {
  const intervalMs = opts.intervalMs ?? 60_000;
  const cooldownMs = opts.cooldownMs ?? 60 * 60_000;
  const newsLookbackMs = opts.newsLookbackMs ?? 6 * 60 * 60_000;
  const queueName = QueueNames.scheduled;

  const queue = createQueue<AlertTick>(queueName, opts.connection);
  const outbound = createQueue<OutboundJob>(QueueNames.outbound, opts.connection);

  void queue.removeJobScheduler(REPEAT_KEY).catch(() => undefined);
  void queue.upsertJobScheduler(
    REPEAT_KEY,
    { every: intervalMs },
    {
      name: 'alerts-tick',
      data: { scheduledAt: Date.now() },
      opts: {
        removeOnComplete: { age: 60 * 60, count: 200 },
        removeOnFail: { age: 24 * 60 * 60 },
        attempts: 1,
      },
    },
  );

  const worker = createWorker<AlertTick, void>({
    name: queueName,
    connection: opts.connection,
    concurrency: 1,
    processor: () =>
      withSentry('alert-engine', async () => {
        const startedAt = Date.now();
        const stats = {
          evaluated: 0,
          fired: 0,
          deliveriesSent: 0,
          suppressed: 0,
          throttled: 0,
          outOfCoverage: 0,
          errors: 0,
        };

        const cooldownThreshold = new Date(Date.now() - cooldownMs);
        const newsCutoff = new Date(Date.now() - newsLookbackMs);

        // Load active alerts that are eligible to fire (never fired
        // OR last_fired_at < now - cooldown).
        const activeAlerts = await withServiceContext(opts.db, async (tx) =>
          tx
            .select()
            .from(schema.alerts)
            .where(
              and(
                eq(schema.alerts.active, true),
                sql`(${schema.alerts.lastFiredAt} IS NULL OR ${schema.alerts.lastFiredAt} < ${cooldownThreshold})`,
              ),
            ),
        );
        stats.evaluated = activeAlerts.length;

        if (activeAlerts.length === 0) {
          opts.log.info({ ...stats, durationMs: Date.now() - startedAt }, 'alerts tick — no work');
          return;
        }

        // Pre-resolve the channel each user wants alerts on. One row
        // per user in channel_links → grab the first linked channel,
        // cached for the tick. A user with no linked channel is
        // skipped (they cannot be reached anyway).
        const userIds = Array.from(new Set(activeAlerts.map((a) => a.userId)));
        const channelLinks = await withServiceContext(opts.db, async (tx) =>
          tx
            .select()
            .from(schema.channelLinks)
            .where(sql`${schema.channelLinks.userId} = ANY(${userIds})`),
        );
        const linkByUser = new Map<string, typeof schema.channelLinks.$inferSelect>();
        for (const link of channelLinks) {
          if (!linkByUser.has(link.userId)) linkByUser.set(link.userId, link);
        }

        // Pre-load preferences for every user with an alert this tick.
        // Used downstream to honor quiet hours, coverage flags, news
        // filter strength, and per-channel mute overrides.
        const prefsByUser = await loadUserPreferencesBatch(opts.db, userIds);

        // Resolve prices for the distinct symbols on price alerts.
        const priceSymbols = Array.from(
          new Set(activeAlerts.filter((a) => a.kind === 'price').map((a) => a.assetSymbol)),
        );
        const priceMap = new Map<string, number>();
        for (const sym of priceSymbols) {
          try {
            const p = await opts.market.getPrice(sym);
            priceMap.set(sym, p.price);
          } catch (err) {
            stats.errors++;
            if (err instanceof RateLimitedError) {
              opts.log.warn({ err }, 'alert engine hit rate limit; deferring price alerts');
              break;
            }
            if (err instanceof UnknownSymbolError) {
              opts.log.warn({ symbol: sym }, 'alert symbol no longer resolves');
            }
          }
        }

        // Pre-load recent high/medium-severity news per asset for news alerts.
        const newsSymbols = Array.from(
          new Set(activeAlerts.filter((a) => a.kind === 'news').map((a) => a.assetSymbol)),
        );
        const newsBySymbol = new Map<string, (typeof schema.newsExtractions.$inferSelect)[]>();
        if (newsSymbols.length > 0) {
          const rows = await withServiceContext(opts.db, async (tx) =>
            tx
              .select()
              .from(schema.newsExtractions)
              .where(
                and(
                  gt(schema.newsExtractions.publishedAt, newsCutoff),
                  sql`${schema.newsExtractions.severity} IN ('medium', 'high')`,
                  sql`${schema.newsExtractions.affectedAssets} && ${newsSymbols}::text[]`,
                ),
              ),
          );
          for (const r of rows) {
            for (const sym of r.affectedAssets) {
              if (!newsBySymbol.has(sym)) newsBySymbol.set(sym, []);
              newsBySymbol.get(sym)!.push(r);
            }
          }
        }

        // Evaluate each alert.
        const tickNow = new Date();
        for (const alert of activeAlerts) {
          const link = linkByUser.get(alert.userId);
          if (!link) continue;

          // Quiet hours: skip pushing alerts during the user's chosen
          // window. Per-channel `muteAlerts` overrides take precedence.
          const prefs = prefsByUser.get(alert.userId);
          if (prefs && shouldSuppressAlert(prefs, link.channel, tickNow)) {
            stats.suppressed++;
            continue;
          }

          // Coverage gating: the user explicitly disabled the asset
          // class this alert kind belongs to. Treats coverage as the
          // umbrella "what this bot is responsible for" toggle; even
          // a user-created alert is silenced when its umbrella is off.
          if (prefs && !alertKindAllowedByCoverage(alert.kind, prefs)) {
            stats.outOfCoverage++;
            continue;
          }

          // Throttling: enforce per-user maxPerHour / maxPerDay caps so
          // a noisy market cannot flood the user. Quota is only consumed
          // on successful claim, so suppressed alerts here also keep
          // their quota unused.
          if (prefs) {
            const allowed = await recordAndCheckPushQuota(opts.connection, alert.userId, prefs);
            if (!allowed) {
              stats.throttled++;
              continue;
            }
          }

          if (alert.kind === 'price') {
            const price = priceMap.get(alert.assetSymbol);
            if (price === undefined) continue;
            const threshold = alert.priceThreshold === null ? null : Number(alert.priceThreshold);
            if (threshold === null || alert.priceOp === null) continue;

            const fires = comparePrice(price, alert.priceOp, threshold);
            if (!fires) continue;

            const dedupKey = `price-cross-${hourBucket(new Date())}`;
            const message = formatPriceMessage(alert.assetSymbol, alert.priceOp, threshold, price);
            await fireDelivery({
              db: opts.db,
              outbound,
              alert,
              link,
              dedupKey,
              message,
              payload: {
                kind: 'price',
                symbol: alert.assetSymbol,
                price,
                threshold,
                op: alert.priceOp,
              },
              stats,
            });
          } else if (alert.kind === 'news') {
            const articles = newsBySymbol.get(alert.assetSymbol) ?? [];
            // Only fire on articles published since the last fire (or
            // since the lookback cutoff if never fired).
            const since = alert.lastFiredAt ?? newsCutoff;
            let fresh = articles.filter((a) => a.publishedAt > since);
            // News filter strength: in `major_only` mode the user only
            // wants high-severity headlines; medium-severity rows are
            // dropped here. `portfolio` and `all` keep both severities
            // since the article was already pre-filtered to the user's
            // watched symbol via affected_assets.
            if (prefs?.newsFilter.strength === 'major_only') {
              fresh = fresh.filter((a) => a.severity === 'high');
            }
            if (fresh.length === 0) continue;

            // Deliver one outbound per fresh article; dedup at the
            // (alert, article) level so a re-tick doesn't double-send.
            for (const article of fresh) {
              const dedupKey = `news-${article.articleId}`;
              const message = formatNewsMessage(alert.assetSymbol, article);
              await fireDelivery({
                db: opts.db,
                outbound,
                alert,
                link,
                dedupKey,
                message,
                payload: {
                  kind: 'news',
                  symbol: alert.assetSymbol,
                  articleId: article.articleId,
                  severity: article.severity,
                },
                stats,
              });
            }
          }
        }

        opts.log.info(
          {
            ...stats,
            priceSymbols: priceSymbols.length,
            newsSymbols: newsSymbols.length,
            durationMs: Date.now() - startedAt,
          },
          'alerts tick complete',
        );
      }),
  });

  return {
    worker,
    queue,
    close: async () => {
      await queue.removeJobScheduler(REPEAT_KEY).catch(() => undefined);
      await worker.close();
      await queue.close();
      await outbound.close();
    },
  };
}

/**
 * Decide whether to skip pushing an alert to a given user/channel given
 * their current preferences. Returns true if the alert should be
 * dropped from this tick (quiet hours active, or the channel is muted
 * via `channelOverrides[channel].muteAlerts`).
 */
function shouldSuppressAlert(
  prefs: BotPreferences,
  channel: 'telegram' | 'discord' | 'whatsapp',
  now: Date,
): boolean {
  const override = prefs.channelOverrides?.[channel];
  // `enabled: false` is an explicit user toggle to pause the channel
  // entirely for unsolicited pushes — distinct from muteAlerts which
  // pauses only alerts. Both behave identically here.
  if (override?.enabled === false) return true;
  if (override?.muteAlerts) return true;
  if (isInQuietHours(prefs, now)) return true;
  return false;
}

/**
 * Map an alert's kind onto the user's coverage flags. The user's
 * coverage choices act as the umbrella "what asset classes is this bot
 * watching" — when the relevant flag is off the alert is silenced even
 * if the user previously created it.
 *
 * News alerts pass when any of the major coverage flags is on; the
 * underlying news_extractions row could be tagged across categories
 * and we deliberately err toward delivery rather than silently dropping.
 */
function alertKindAllowedByCoverage(
  kind: 'price' | 'news' | 'etf_flow' | 'index_move' | 'sentiment' | 'macro',
  prefs: BotPreferences,
): boolean {
  switch (kind) {
    case 'price':
    case 'sentiment':
      return prefs.coverage.currencies;
    case 'etf_flow':
      return prefs.coverage.etfs;
    case 'index_move':
      return prefs.coverage.ssiIndices;
    case 'macro':
      return prefs.coverage.macro;
    case 'news':
      return (
        prefs.coverage.currencies ||
        prefs.coverage.etfs ||
        prefs.coverage.ssiIndices ||
        prefs.coverage.macro ||
        prefs.coverage.cryptoStocks ||
        prefs.coverage.btcTreasuries ||
        prefs.coverage.fundraising
      );
  }
}

/** Price threshold comparison. Returns true when the current price triggers the alert's operator. */
function comparePrice(price: number, op: 'lt' | 'lte' | 'gt' | 'gte', threshold: number): boolean {
  switch (op) {
    case 'lt':
      return price < threshold;
    case 'lte':
      return price <= threshold;
    case 'gt':
      return price > threshold;
    case 'gte':
      return price >= threshold;
  }
}

/**
 * Human-readable outbound text for a price-crossing alert. Matches the
 * direction prefix ("below" / "above") to the operator. Uses 4 decimal
 * places for sub-dollar prices and 2 for everything else.
 */
function formatPriceMessage(
  symbol: string,
  op: 'lt' | 'lte' | 'gt' | 'gte',
  threshold: number,
  price: number,
): string {
  const direction = op === 'lt' || op === 'lte' ? 'below' : 'above';
  return `${symbol} is now ${direction} $${threshold} — currently $${price.toFixed(price < 1 ? 4 : 2)}.`;
}

/**
 * Human-readable outbound text for a news-match alert. Prefixes severity
 * with emoji (🔴 high / 🟡 medium) for rich rendering in Telegram/Discord.
 */
function formatNewsMessage(
  symbol: string,
  article: typeof schema.newsExtractions.$inferSelect,
): string {
  const tag = article.severity === 'high' ? '🔴' : '🟡';
  return `${tag} ${symbol}: ${article.summary}\n${article.title}${article.url ? `\n${article.url}` : ''}`;
}

/**
 * Floor the date to the top of the current UTC hour. Used as a dedup-key
 * suffix so price-cross alerts fire at most once per hour per symbol per
 * cooldown window.
 */
function hourBucket(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

interface FireDeliveryArgs {
  db: Database;
  outbound: Queue<OutboundJob>;
  alert: typeof schema.alerts.$inferSelect;
  link: typeof schema.channelLinks.$inferSelect;
  dedupKey: string;
  message: string;
  payload: Record<string, unknown>;
  stats: { fired: number; deliveriesSent: number };
}

/**
 * Tries to claim a delivery slot via the unique constraint. If the
 * INSERT returns a row we own the delivery and enqueue the outbound;
 * if it conflicts another tick already sent it. Stamping
 * `alerts.last_fired_at` on success starts the per-alert cooldown.
 */
async function fireDelivery(args: FireDeliveryArgs): Promise<void> {
  const { db, outbound, alert, link, dedupKey, message, payload, stats } = args;
  const claimed = await withServiceContext(db, async (tx) =>
    tx
      .insert(schema.notificationDeliveries)
      .values({
        userId: alert.userId,
        alertId: alert.id,
        channel: link.channel,
        dedupKey,
        payload: payload,
      })
      .onConflictDoNothing()
      .returning({ id: schema.notificationDeliveries.id }),
  );
  if (claimed.length === 0) return;

  stats.fired++;

  await outbound.add(
    'outbound',
    {
      userId: alert.userId,
      channel: link.channel,
      externalUserId: link.channelUserId,
      conversationId: link.channelUserId,
      text: message,
      ...(link.channel === 'whatsapp' ? { whatsappTemplate: 'alert' as const } : {}),
      idempotencyKey: `alert-${alert.id}-${dedupKey}`,
    },
    { jobId: `alert-${alert.id}-${dedupKey}` },
  );
  stats.deliveriesSent++;

  await withServiceContext(db, async (tx) =>
    tx.update(schema.alerts).set({ lastFiredAt: new Date() }).where(eq(schema.alerts.id, alert.id)),
  );
}
