import { Redis, type RedisOptions } from 'ioredis';

export interface CreateConnectionOptions {
  url: string;
}

/**
 * Build a BullMQ-compatible Redis connection.
 *
 * BullMQ requires `maxRetriesPerRequest: null` so blocking commands wait
 * indefinitely. The Redis instance hosting BullMQ MUST be configured with
 * `maxmemory-policy=noeviction` or queue correctness is at risk.
 */
export function createConnection(opts: CreateConnectionOptions): Redis {
  const redisOpts: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  };
  return new Redis(opts.url, redisOpts);
}

export type { Redis } from 'ioredis';
