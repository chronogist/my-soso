import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Lua script that releases a lock only if the supplied token matches the
 * stored value. Prevents a slow worker from releasing a lock that another
 * worker has since acquired.
 */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export interface AcquireLockOptions {
  /** Redis key for the lock. */
  key: string;
  /** Lock TTL in milliseconds. Defaults to 30 000. */
  ttlMs?: number;
}

export interface LockHandle {
  /** Release the lock. Safe to call even if the lock has already expired. */
  release: () => Promise<void>;
}

/**
 * Acquire a Redis lock keyed on `conversationId`. Returns null if another
 * worker already holds the lock. The TTL guards against stuck locks if a
 * worker crashes mid-process.
 *
 * Pattern is `SET key token NX PX ttl` plus a Lua release-if-match.
 */
export async function acquireLock(
  redis: Redis,
  { key, ttlMs = 30_000 }: AcquireLockOptions,
): Promise<LockHandle | null> {
  const token = randomUUID();
  const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (result !== 'OK') return null;

  return {
    release: async () => {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    },
  };
}

export function conversationLockKey(conversationId: string): string {
  return `lock:conversation:${conversationId}`;
}
