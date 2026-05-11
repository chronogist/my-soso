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
/**
 * Sequence bookkeeping only matters while a conversation is active or
 * while a recent retry could still arrive. Expire idle conversations so
 * one-off chats do not accumulate forever in Redis.
 */
const CONVERSATION_SEQ_TTL_SECONDS = 14 * 24 * 60 * 60;

export async function nextConversationSeq(redis: Redis, conversationId: string): Promise<number> {
  const key = `${SEQ_KEY_PREFIX}:${conversationId}`;
  const seqNo = await redis.incr(key);
  await redis.expire(key, CONVERSATION_SEQ_TTL_SECONDS);
  return seqNo;
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
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
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
    String(CONVERSATION_SEQ_TTL_SECONDS),
  )) as number;
  return result === 1;
}
