import { tool } from 'ai';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  ProviderError,
  RateLimitedError,
  UnknownSymbolError,
  type MarketDataProvider,
  type NewsProvider,
} from '@my-soso/providers';
import { schema, withTenantUser, type Database } from '@my-soso/db';
import { ensureDefaultWatchlist } from './watchlist.js';

const SymbolArg = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9._-]+$/, 'symbols must be alphanumeric, dot, dash or underscore')
  .describe('Asset ticker (e.g. "BTC", "ETH", "SOL").');

export interface ToolDeps {
  market: MarketDataProvider;
  news: NewsProvider;
  db: Database;
  /** Authenticated user. Watchlist mutations are scoped to this id. */
  userId: string;
}

/**
 * Builds the per-message tool set. Tools that mutate user state
 * (addToWatchlist, removeFromWatchlist) close over `userId` and
 * write through `withTenantUser` so RLS enforces the tenant
 * boundary at the database — even a malicious tool argument
 * cannot reach another user's row.
 *
 * The bundle is rebuilt per agent.run() call. The cost is small
 * (closure allocation) and it keeps the per-user context purely
 * inside the function rather than threading it through Vercel AI
 * SDK internals.
 */
export function buildAgentTools({ market, news, db, userId }: ToolDeps) {
  return {
    getPrice: tool({
      description:
        'Fetch the current spot price and 24h change for a crypto asset by ticker symbol.',
      inputSchema: z.object({ symbol: SymbolArg }),
      execute: async ({ symbol }) => {
        try {
          const p = await market.getPrice(symbol);
          return {
            ok: true as const,
            symbol: p.symbol,
            priceUsd: p.price,
            change24hPct: p.change24hPct,
            marketCapUsd: p.marketCapUsd,
            volume24hUsd: p.volume24hUsd,
            asOf: p.asOf.toISOString(),
          };
        } catch (err) {
          return mapToolError(err, symbol);
        }
      },
    }),

    getNewsForAsset: tool({
      description:
        'Fetch recent news headlines for a crypto asset by ticker symbol. Returns up to 10 items with title, source, and a short summary.',
      inputSchema: z.object({
        symbol: SymbolArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe('Maximum number of news items to return.'),
      }),
      execute: async ({ symbol, limit }) => {
        try {
          const items = await news.getNewsForAsset(symbol, { limit });
          return {
            ok: true as const,
            symbol: symbol.toUpperCase(),
            items: items.map((n) => ({
              title: n.title,
              url: n.url,
              publisher: n.publisher,
              summary: n.summary,
              publishedAt: n.publishedAt.toISOString(),
            })),
          };
        } catch (err) {
          return mapToolError(err, symbol);
        }
      },
    }),

    listWatchlist: tool({
      description:
        "List the symbols currently on the user's watchlist. No arguments. Returns an array of {symbol, assetKind} objects.",
      inputSchema: z.object({}),
      execute: async () => {
        const watchlist = await ensureDefaultWatchlist(db, userId);
        const items = await withTenantUser(db, userId, async (tx) =>
          tx
            .select()
            .from(schema.watchlistItems)
            .where(eq(schema.watchlistItems.watchlistId, watchlist.id))
            .orderBy(schema.watchlistItems.createdAt),
        );
        return {
          ok: true as const,
          items: items.map((i) => ({ symbol: i.assetSymbol, assetKind: i.assetKind })),
        };
      },
    }),

    addToWatchlist: tool({
      description:
        "Add a crypto asset to the user's watchlist by ticker symbol. Idempotent: adding a symbol already on the list is a NOOP.",
      inputSchema: z.object({ symbol: SymbolArg }),
      execute: async ({ symbol }) => {
        const upper = symbol.toUpperCase();
        // Validate the symbol exists upstream before writing — prevents
        // typos like "BTCC" from polluting the user's list. resolveSymbol
        // is private to the provider, so we use getPrice as the probe;
        // the cache absorbs the cost on repeat asks.
        try {
          await market.getPrice(upper);
        } catch (err) {
          if (err instanceof UnknownSymbolError) {
            return {
              ok: false as const,
              reason: 'unknown_symbol' as const,
              message: `I don't recognise "${symbol}". Try the asset's standard ticker.`,
            };
          }
          // Don't block on transient provider issues — accept the symbol.
        }
        const watchlist = await ensureDefaultWatchlist(db, userId);
        await withTenantUser(db, userId, async (tx) =>
          tx
            .insert(schema.watchlistItems)
            .values({
              userId,
              watchlistId: watchlist.id,
              assetSymbol: upper,
              assetKind: 'crypto',
            })
            .onConflictDoNothing(),
        );
        return { ok: true as const, symbol: upper };
      },
    }),

    removeFromWatchlist: tool({
      description: "Remove a crypto asset from the user's watchlist by ticker symbol.",
      inputSchema: z.object({ symbol: SymbolArg }),
      execute: async ({ symbol }) => {
        const upper = symbol.toUpperCase();
        const removed = await withTenantUser(db, userId, async (tx) =>
          tx
            .delete(schema.watchlistItems)
            .where(
              and(
                eq(schema.watchlistItems.userId, userId),
                eq(schema.watchlistItems.assetSymbol, upper),
              ),
            )
            .returning({ id: schema.watchlistItems.id }),
        );
        return {
          ok: true as const,
          symbol: upper,
          removed: removed.length > 0,
        };
      },
    }),

    listAlerts: tool({
      description:
        "List the user's active alerts. No arguments. Returns id, name, kind, symbol, and (for price alerts) op + threshold.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await withTenantUser(db, userId, async (tx) =>
          tx
            .select()
            .from(schema.alerts)
            .where(and(eq(schema.alerts.userId, userId), eq(schema.alerts.active, true)))
            .orderBy(schema.alerts.createdAt),
        );
        return {
          ok: true as const,
          alerts: rows.map((a) => ({
            id: a.id,
            name: a.name,
            kind: a.kind,
            symbol: a.assetSymbol,
            priceOp: a.priceOp,
            priceThreshold: a.priceThreshold !== null ? Number(a.priceThreshold) : null,
            createdAt: a.createdAt.toISOString(),
          })),
        };
      },
    }),

    setPriceAlert: tool({
      description:
        'Create a price-threshold alert that fires when an asset crosses a level. Use op "lt" / "lte" for "drops below or to" and "gt" / "gte" for "rises above or to".',
      inputSchema: z.object({
        symbol: SymbolArg,
        op: z.enum(['lt', 'lte', 'gt', 'gte']).describe('Comparison operator.'),
        threshold: z.number().positive().describe('Price level in USD.'),
        name: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Optional human-readable label; auto-generated if omitted.'),
      }),
      execute: async ({ symbol, op, threshold, name }) => {
        const upper = symbol.toUpperCase();
        try {
          await market.getPrice(upper);
        } catch (err) {
          if (err instanceof UnknownSymbolError) {
            return {
              ok: false as const,
              reason: 'unknown_symbol' as const,
              message: `I don't recognise "${symbol}". Try the asset's standard ticker.`,
            };
          }
        }
        const friendlyOp = op === 'lt' || op === 'lte' ? 'drops below' : 'rises above';
        const label = name ?? `${upper} ${friendlyOp} $${threshold}`;
        const [created] = await withTenantUser(db, userId, async (tx) =>
          tx
            .insert(schema.alerts)
            .values({
              userId,
              name: label,
              kind: 'price',
              assetSymbol: upper,
              assetKind: 'crypto',
              priceOp: op,
              // numeric() is stored as string in postgres-js; drizzle accepts string.
              priceThreshold: threshold.toString(),
              active: true,
            })
            .returning({ id: schema.alerts.id, name: schema.alerts.name }),
        );
        if (!created) {
          return {
            ok: false as const,
            reason: 'unknown_error' as const,
            message: 'Could not create the alert.',
          };
        }
        return { ok: true as const, id: created.id, name: created.name };
      },
    }),

    setNewsAlert: tool({
      description:
        'Create a news alert that fires when a high-severity news article tagged to the asset is published.',
      inputSchema: z.object({
        symbol: SymbolArg,
        name: z.string().min(1).max(80).optional(),
      }),
      execute: async ({ symbol, name }) => {
        const upper = symbol.toUpperCase();
        const label = name ?? `${upper} breaking news`;
        const [created] = await withTenantUser(db, userId, async (tx) =>
          tx
            .insert(schema.alerts)
            .values({
              userId,
              name: label,
              kind: 'news',
              assetSymbol: upper,
              assetKind: 'crypto',
              active: true,
            })
            .returning({ id: schema.alerts.id, name: schema.alerts.name }),
        );
        if (!created) {
          return {
            ok: false as const,
            reason: 'unknown_error' as const,
            message: 'Could not create the alert.',
          };
        }
        return { ok: true as const, id: created.id, name: created.name };
      },
    }),

    removeAlert: tool({
      description: "Delete one of the user's alerts by id (UUID returned from listAlerts).",
      inputSchema: z.object({
        alertId: z.string().uuid().describe('Alert id from listAlerts.'),
      }),
      execute: async ({ alertId }) => {
        const removed = await withTenantUser(db, userId, async (tx) =>
          tx
            .delete(schema.alerts)
            .where(and(eq(schema.alerts.userId, userId), eq(schema.alerts.id, alertId)))
            .returning({ id: schema.alerts.id }),
        );
        return { ok: true as const, removed: removed.length > 0 };
      },
    }),
  };
}

export type AgentTools = ReturnType<typeof buildAgentTools>;

function mapToolError(err: unknown, symbol: string) {
  if (err instanceof UnknownSymbolError) {
    return {
      ok: false as const,
      reason: 'unknown_symbol' as const,
      message: `I don't recognise "${symbol}". Try the asset's standard ticker.`,
    };
  }
  if (err instanceof RateLimitedError) {
    return {
      ok: false as const,
      reason: 'rate_limited' as const,
      message: 'My data provider is rate-limited right now. Try again in a moment.',
    };
  }
  if (err instanceof ProviderError) {
    return {
      ok: false as const,
      reason: 'provider_unavailable' as const,
      message: 'My data provider is temporarily unavailable.',
    };
  }
  return {
    ok: false as const,
    reason: 'unknown_error' as const,
    message: 'Something went wrong fetching that data.',
  };
}
