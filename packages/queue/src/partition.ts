import { createHash } from 'node:crypto';
import { QueueNames } from './jobs.js';

/**
 * Number of inbound queue partitions. Same-conversation jobs always hash
 * to the same partition, giving per-conversation FIFO without BullMQ Pro.
 *
 * Re-partitioning (changing this value) requires draining old partitions
 * first to avoid out-of-order processing during the transition. Document
 * any change in the runbook.
 */
export const INBOUND_PARTITION_COUNT = 8;

/**
 * Map a conversation ID to an inbound partition index. Uses the first
 * 4 bytes of SHA-256 as a uint32, then mods by partition count. Deterministic
 * — the same conversation always lands on the same partition, giving
 * per-conversation FIFO without BullMQ Pro.
 */
export function partitionFor(conversationId: string, partitions = INBOUND_PARTITION_COUNT): number {
  const hash = createHash('sha256').update(conversationId).digest();
  // First 4 bytes as unsigned int32 → mod partitions.
  const n = hash.readUInt32BE(0);
  return n % partitions;
}

/**
 * Resolve the inbound queue name a given conversation's job should be
 * enqueued on. Called by the Edge service before publishing a job.
 */
export function inboundQueueFor(
  conversationId: string,
  partitions = INBOUND_PARTITION_COUNT,
): string {
  return `${QueueNames.inboundPrefix}-${partitionFor(conversationId, partitions)}`;
}

/** All inbound queue names the Worker should consume from. Draining old
 * partitions when re-partitioning requires the old queues to be empty first
 * (see the `INBOUND_PARTITION_COUNT` module doc).
 */
export function allInboundQueueNames(partitions = INBOUND_PARTITION_COUNT): string[] {
  return Array.from({ length: partitions }, (_, i) => `${QueueNames.inboundPrefix}-${i}`);
}
