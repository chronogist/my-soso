import {
  createQueue,
  createWorker,
  QueueNames,
  type Queue,
  type Redis,
  type Worker,
} from '@my-soso/queue';
import {
  RateLimitedError,
  type MarketDataProvider,
  type NewsItem,
  type NewsProvider,
} from '@my-soso/providers';
import type { Logger } from 'pino';
import type { NewsExtractor } from '../agent/news-extractor.js';
import { withSentry } from '../sentry.js';

/**
 * Prefetcher: a singleton repeatable BullMQ job that warms the cache
 * for the most-asked-about assets so on-demand user questions hit the
 * cache instead of spending precious upstream quota.
 *
 * Important: this is a **singleton across the cluster**, not once per
 * pod. We achieve that with a stable `repeatJobKey` — BullMQ will only
 * run one instance per scheduled tick regardless of how many workers
 * pick the queue. See architecture.md → "Singleton workloads".
 *
 * Errors during a tick are swallowed (and logged) on purpose: a tick
 * miss only means cache freshness regresses by one cycle, never that
 * the queue stops scheduling.
 */

interface PrefetchTick {
  scheduledAt: number;
}

export interface PrefetcherOptions {
  connection: Redis;
  log: Logger;
  provider: MarketDataProvider & NewsProvider;
  /** Optional: extract and persist news classifications after each tick. */
  newsExtractor?: NewsExtractor;
  /** Symbols to keep warm. Default: BTC, ETH, SOL. */
  symbols?: readonly string[];
  /** Tick cadence in ms. Default 60_000 (1 min). */
  intervalMs?: number;
  /** News items to prefetch per asset. Default 5. */
  newsLimit?: number;
}

export interface PrefetcherHandles {
  worker: Worker<PrefetchTick>;
  queue: Queue<PrefetchTick>;
  close: () => Promise<void>;
}

const REPEAT_KEY = 'prefetch:warm-top-assets';

export function startPrefetcher(opts: PrefetcherOptions): PrefetcherHandles {
  const symbols = opts.symbols ?? ['BTC', 'ETH', 'SOL'];
  const intervalMs = opts.intervalMs ?? 60_000;
  const newsLimit = opts.newsLimit ?? 5;
  const queueName = QueueNames.scheduled;

  const queue = createQueue<PrefetchTick>(queueName, opts.connection);

  // Replace any pre-existing repeat schedule so config changes (cadence,
  // symbols) take effect at boot without manual cleanup.
  void queue.removeJobScheduler(REPEAT_KEY).catch(() => {
    /* no scheduler present */
  });
  void queue.upsertJobScheduler(
    REPEAT_KEY,
    { every: intervalMs },
    {
      name: 'prefetch-tick',
      data: { scheduledAt: Date.now() },
      opts: {
        removeOnComplete: { age: 60 * 60, count: 200 },
        removeOnFail: { age: 24 * 60 * 60 },
        attempts: 1,
      },
    },
  );

  const worker = createWorker<PrefetchTick, void>({
    name: queueName,
    connection: opts.connection,
    concurrency: 1,
    processor: () =>
      withSentry('prefetcher', async () => {
        const startedAt = Date.now();
        let priceHits = 0;
        let newsHits = 0;
        const errors: string[] = [];
        const newsItems: NewsItem[] = [];

        // Sequential rather than parallel so we don't blow the
        // per-minute token bucket in a single instant.
        for (const symbol of symbols) {
          try {
            await opts.provider.getPrice(symbol);
            priceHits++;
          } catch (err) {
            errors.push(`price:${symbol}:${describeErr(err)}`);
            if (err instanceof RateLimitedError) break;
          }
          try {
            const items = await opts.provider.getNewsForAsset(symbol, { limit: newsLimit });
            newsHits++;
            newsItems.push(...items);
          } catch (err) {
            errors.push(`news:${symbol}:${describeErr(err)}`);
            if (err instanceof RateLimitedError) break;
          }
        }

        let extracted = 0;
        let extractionSkipped = 0;
        if (opts.newsExtractor && newsItems.length > 0) {
          try {
            const result = await opts.newsExtractor.extractMissing(newsItems);
            extracted = result.inserted;
            extractionSkipped = result.skipped;
          } catch (err) {
            errors.push(`extract:${describeErr(err)}`);
          }
        }

        opts.log.info(
          {
            symbols: symbols.length,
            priceHits,
            newsHits,
            newsItemCount: newsItems.length,
            extracted,
            extractionSkipped,
            durationMs: Date.now() - startedAt,
            errorCount: errors.length,
            errorSample: errors.slice(0, 3),
          },
          'prefetch tick complete',
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
    },
  };
}

function describeErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return 'unknown';
}
