/**
 * Generic key/value cache contract used by the cached provider
 * wrapper. We intentionally keep the surface small so it maps cleanly
 * to either Redis or an in-memory test stub.
 */
export interface ProviderCache {
  /** Returns the JSON-decoded value or `null` on a miss. */
  get: <T>(key: string) => Promise<T | null>;
  /** Sets `value` with a TTL in seconds. */
  set: (key: string, value: unknown, ttlSeconds: number) => Promise<void>;
}

export interface CacheMetrics {
  onHit?: (key: string) => void;
  onMiss?: (key: string) => void;
  onError?: (key: string, err: unknown) => void;
}

import type { Redis } from '@my-soso/queue';

/**
 * Thin Redis-backed implementation. Errors during get/set are
 * swallowed and reported via `metrics.onError` because a cache
 * failure must never break a live request — the wrapper falls
 * through to the underlying provider.
 */
export function createRedisProviderCache(
  redis: Redis,
  opts: { keyPrefix?: string; metrics?: CacheMetrics } = {},
): ProviderCache {
  const prefix = opts.keyPrefix ?? 'provider-cache';
  const metrics = opts.metrics;
  return {
    get: async (key) => {
      const fullKey = `${prefix}:${key}`;
      try {
        const raw = await redis.get(fullKey);
        if (raw === null) {
          metrics?.onMiss?.(key);
          return null;
        }
        metrics?.onHit?.(key);
        return JSON.parse(raw) as never;
      } catch (err) {
        metrics?.onError?.(key, err);
        return null;
      }
    },
    set: async (key, value, ttlSeconds) => {
      const fullKey = `${prefix}:${key}`;
      try {
        await redis.set(fullKey, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSeconds)));
      } catch (err) {
        metrics?.onError?.(key, err);
      }
    },
  };
}
