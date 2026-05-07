import type { TokenBucket } from '@my-soso/queue';
import type { ProviderCache } from './cache.js';
import type { BudgetTracker } from './budget.js';
import type { MarketDataProvider } from './market-data.js';
import type { NewsProvider } from './news.js';
import { RateLimitedError, type ETFFlow, type Index, type NewsItem, type Price } from './types.js';

const PROVIDER_NAME = 'composed';

export interface CacheTtls {
  /** TTL for `getPrice` and `getPrices` entries. Default 30s. */
  priceSeconds?: number;
  /** TTL for `getETFFlow`. Default 5min. */
  etfFlowSeconds?: number;
  /** TTL for `getIndex` and `listIndices`. Default 60s. */
  indexSeconds?: number;
  /** TTL for `getNewsForAsset` and `getLatestNews`. Default 60s. */
  newsSeconds?: number;
}

export interface ComposeProviderOptions {
  inner: MarketDataProvider & NewsProvider;
  cache: ProviderCache;
  /** Per-minute upstream token bucket. Optional (skip for local/dev). */
  rateLimit?: TokenBucket;
  /** Monthly budget. Optional (skip for local/dev). */
  budget?: BudgetTracker;
  ttls?: CacheTtls;
  /**
   * Stable name embedded in cache keys. Defaults to `inner.name`. Set
   * this when you swap the inner provider in tests so cached entries
   * don't bleed across implementations.
   */
  cacheNamespace?: string;
}

/**
 * Wraps an inner provider with cache → token bucket → budget. Each
 * method:
 *   1. Compute a cache key from method + args.
 *   2. cache.get → on hit, return immediately (no quota consumed).
 *   3. token bucket → if denied, raise RateLimitedError.
 *   4. budget.acquire → if exhausted, raise RateLimitedError.
 *   5. inner.method() → on success, cache the result.
 *
 * Cache writes are best-effort: a failed `set` is logged via cache
 * metrics but never fails the request.
 */
export function composeProvider(opts: ComposeProviderOptions): MarketDataProvider & NewsProvider {
  const ttls: Required<CacheTtls> = {
    priceSeconds: opts.ttls?.priceSeconds ?? 30,
    etfFlowSeconds: opts.ttls?.etfFlowSeconds ?? 300,
    indexSeconds: opts.ttls?.indexSeconds ?? 60,
    newsSeconds: opts.ttls?.newsSeconds ?? 60,
  };
  const ns = opts.cacheNamespace ?? opts.inner.name;

  async function withQuota<T>(load: () => Promise<T>): Promise<T> {
    if (opts.rateLimit) {
      const result = await opts.rateLimit.take(1);
      if (!result.allowed) {
        throw new RateLimitedError('per-minute upstream limit reached', {
          provider: PROVIDER_NAME,
          retryAfterMs: result.retryAfterMs,
        });
      }
    }
    if (opts.budget) {
      const ok = await opts.budget.acquire(1);
      if (!ok) {
        throw new RateLimitedError('monthly upstream budget exhausted', {
          provider: PROVIDER_NAME,
        });
      }
    }
    return load();
  }

  async function memoize<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = await opts.cache.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await withQuota(load);
    await opts.cache.set(key, fresh, ttlSeconds);
    return fresh;
  }

  return {
    name: PROVIDER_NAME,

    getPrice: (symbol) =>
      memoize(`${ns}:price:${symbol.toUpperCase()}`, ttls.priceSeconds, () =>
        opts.inner.getPrice(symbol),
      ),

    getPrices: async (symbols) => {
      // Granular caching: hit per-symbol cache first, only spend
      // upstream calls on the misses.
      const out = new Map<string, Price>();
      const missing: string[] = [];
      for (const s of symbols) {
        const upper = s.toUpperCase();
        const hit = await opts.cache.get<Price>(`${ns}:price:${upper}`);
        if (hit) out.set(upper, hit);
        else missing.push(s);
      }
      if (missing.length > 0) {
        const fresh = await withQuota(() => opts.inner.getPrices(missing));
        for (const [sym, price] of fresh) {
          out.set(sym, price);
          await opts.cache.set(`${ns}:price:${sym}`, price, ttls.priceSeconds);
        }
      }
      return out;
    },

    getETFFlow: (symbol) =>
      memoize<ETFFlow>(`${ns}:etf:${symbol.toUpperCase()}`, ttls.etfFlowSeconds, () =>
        opts.inner.getETFFlow(symbol),
      ),

    getIndex: (symbol) =>
      memoize<Index>(`${ns}:index:${symbol.toUpperCase()}`, ttls.indexSeconds, () =>
        opts.inner.getIndex(symbol),
      ),

    listIndices: () =>
      memoize<readonly Index[]>(`${ns}:indices`, ttls.indexSeconds, () => opts.inner.listIndices()),

    getNewsForAsset: (symbol, newsOpts) => {
      const limit = newsOpts?.limit ?? 10;
      return memoize<readonly NewsItem[]>(
        `${ns}:news:asset:${symbol.toUpperCase()}:${limit}`,
        ttls.newsSeconds,
        () => opts.inner.getNewsForAsset(symbol, { limit }),
      );
    },

    getLatestNews: (newsOpts) => {
      const limit = newsOpts?.limit ?? 20;
      return memoize<readonly NewsItem[]>(`${ns}:news:latest:${limit}`, ttls.newsSeconds, () =>
        opts.inner.getLatestNews({ limit }),
      );
    },
  };
}
