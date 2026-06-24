import type { Redis } from 'ioredis';

export interface TokenBucketOptions {
  /** Redis key prefix; final key is `${keyPrefix}:${name}`. */
  keyPrefix?: string;
  /** Logical bucket name (e.g. 'sosovalue:rpm'). */
  name: string;
  /** Maximum tokens the bucket holds. Defaults to `refillRate`. */
  capacity?: number;
  /** Tokens added per `refillIntervalMs`. */
  refillRate: number;
  /** Refill interval; default 60s. */
  refillIntervalMs?: number;
}

export interface TokenBucketTakeResult {
  allowed: boolean;
  /** Tokens left after this call. -1 if denied. */
  remaining: number;
  /**
   * Milliseconds until enough tokens are available again. 0 when the
   * call was allowed.
   */
  retryAfterMs: number;
}

/**
 * Atomic Lua script. KEYS[1] holds a small Redis hash with two fields:
 *   - tokens     : float, current bucket level
 *   - updatedAt  : integer ms epoch of last refill
 *
 * ARGV: capacity, refillRate, refillIntervalMs, requested, nowMs.
 *
 * The script refills lazily based on elapsed time, attempts to debit
 * `requested` tokens, and returns:
 *   { allowed (1|0), remainingTokensFloor, retryAfterMs }
 */
const TAKE_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local refillIntervalMs = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local nowMs = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'updatedAt')
local tokens = tonumber(data[1])
local updatedAt = tonumber(data[2])

if tokens == nil or updatedAt == nil then
  tokens = capacity
  updatedAt = nowMs
end

local elapsedMs = nowMs - updatedAt
if elapsedMs < 0 then elapsedMs = 0 end
local refilled = (elapsedMs / refillIntervalMs) * refillRate
tokens = math.min(capacity, tokens + refilled)
updatedAt = nowMs

local allowed = 0
local retryAfterMs = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  local deficit = requested - tokens
  retryAfterMs = math.ceil((deficit / refillRate) * refillIntervalMs)
end

redis.call('HMSET', key, 'tokens', tokens, 'updatedAt', updatedAt)
-- Generous TTL so abandoned buckets eventually GC, but long enough to
-- survive a full refill cycle.
local ttlSeconds = math.ceil((capacity / refillRate) * (refillIntervalMs / 1000)) + 60
redis.call('EXPIRE', key, ttlSeconds)

return { allowed, math.floor(tokens), retryAfterMs }
`;

export interface TokenBucket {
  take: (count?: number) => Promise<TokenBucketTakeResult>;
}

/**
 * Creates a Redis-backed token-bucket rate limiter.
 *
 * The Lua script implements lazy refill — tokens are computed on every
 * `take()` based on elapsed wall-clock time (no background cron needed).
 * The bucket key auto-expires after being idle for one full refill cycle
 * + 60s so abandoned keys do not accumulate in Redis.
 *
 * Used by `composeProvider` to enforce per-minute upstream API limits.
 */
export function createTokenBucket(redis: Redis, opts: TokenBucketOptions): TokenBucket {
  const keyPrefix = opts.keyPrefix ?? 'tokenbucket';
  const key = `${keyPrefix}:${opts.name}`;
  const capacity = opts.capacity ?? opts.refillRate;
  const refillIntervalMs = opts.refillIntervalMs ?? 60_000;

  return {
    take: async (count = 1) => {
      const result = (await redis.eval(
        TAKE_SCRIPT,
        1,
        key,
        capacity,
        opts.refillRate,
        refillIntervalMs,
        count,
        Date.now(),
      )) as [number, number, number];
      return {
        allowed: result[0] === 1,
        remaining: result[1],
        retryAfterMs: result[2],
      };
    },
  };
}
