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

/** Compute the partition index for a given conversation ID. */
export function partitionFor(conversationId: string, partitions = INBOUND_PARTITION_COUNT): number {
  const hash = createHash('sha256').update(conversationId).digest();
  // First 4 bytes as unsigned int32 → mod partitions.
  const n = hash.readUInt32BE(0);
  return n % partitions;
}

/** Resolve the inbound queue name a job should land on. */
export function inboundQueueFor(
  conversationId: string,
  partitions = INBOUND_PARTITION_COUNT,
): string {
  return `${QueueNames.inboundPrefix}-${partitionFor(conversationId, partitions)}`;
}

/** All inbound queue names a worker should consume from. */
export function allInboundQueueNames(partitions = INBOUND_PARTITION_COUNT): string[] {
  return Array.from({ length: partitions }, (_, i) => `${QueueNames.inboundPrefix}-${i}`);
}
