import type { Redis } from 'ioredis';

/**
 * Per-conversation monotonic sequence counter. Stamped onto each inbound
 * job at enqueue time and used by the Worker's FIFO guard.
 *
 * Redis INCR is atomic, so two Edge replicas issuing concurrent inbound
 * messages for the same conversation get distinct, ordered sequence
 * numbers without coordination.
 */
const SEQ_KEY_PREFIX = 'seq:conversation';
const PROCESSED_KEY_PREFIX = 'processed:conversation';

export function nextConversationSeq(redis: Redis, conversationId: string): Promise<number> {
  return redis.incr(`${SEQ_KEY_PREFIX}:${conversationId}`);
}

export async function lastProcessedSeq(redis: Redis, conversationId: string): Promise<number> {
  const v = await redis.get(`${PROCESSED_KEY_PREFIX}:${conversationId}`);
  return v ? Number(v) : 0;
}

/**
 * Atomically advance the processed counter only if the supplied seqNo is
 * exactly one greater. Lua guarantees no two workers can both bump past
 * the same value.
 */
const ADVANCE_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local next = tonumber(ARGV[1])
if next == current + 1 then
  redis.call("SET", KEYS[1], next)
  return 1
else
  return 0
end
`;

export async function advanceProcessedSeq(
  redis: Redis,
  conversationId: string,
  seqNo: number,
): Promise<boolean> {
  const result = (await redis.eval(
    ADVANCE_SCRIPT,
    1,
    `${PROCESSED_KEY_PREFIX}:${conversationId}`,
    String(seqNo),
  )) as number;
  return result === 1;
}
