import { Redis, type RedisOptions } from 'ioredis';

export interface CreateConnectionOptions {
  url: string;
  name?: string;
  onError?: (err: Error) => void;
}

/**
 * Build a BullMQ-compatible Redis connection.
 *
 * BullMQ requires `maxRetriesPerRequest: null` so blocking commands wait
 * indefinitely. The Redis instance hosting BullMQ MUST be configured with
 * `maxmemory-policy=noeviction` or queue correctness is at risk.
 */
export function createConnection(opts: CreateConnectionOptions): Redis {
  const parsed = new URL(opts.url);
  const redisOpts: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
  const redis = new Redis(opts.url, redisOpts);

  // Always attach an error listener so transient network/auth/TLS issues do
  // not surface as unhandled EventEmitter crashes. Callers can still provide
  // service-specific logging for diagnosis.
  redis.on('error', (err) => {
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
  });

  return redis;
}

export type { Redis } from 'ioredis';
