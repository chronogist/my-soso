import { z } from 'zod';

const ChannelEnum = z.enum(['telegram', 'discord', 'whatsapp']);

/**
 * Inbound: a chat-platform message handed off from the Edge service
 * to the Worker for agent processing.
 */
export const InboundJobSchema = z.object({
  userId: z.string().uuid(),
  channel: ChannelEnum,
  externalUserId: z.string().min(1),
  conversationId: z.string().min(1),
  text: z.string(),
  /** Inbound message ID from the platform — also the BullMQ job ID. */
  idempotencyKey: z.string().min(1),
  /**
   * Strictly monotonic per-conversation sequence number stamped at
   * enqueue time. The Worker only processes the job whose `seqNo`
   * equals `lastProcessedSeq + 1` for that conversation, guaranteeing
   * FIFO regardless of retry timing across pods.
   */
  seqNo: z.number().int().positive(),
  receivedAt: z.coerce.date(),
});
export type InboundJob = z.infer<typeof InboundJobSchema>;

/**
 * Outbound: a reply to be delivered to a user via the channel they came in on.
 * Produced by the Worker (agent or alert engine), consumed by the outbound
 * delivery worker.
 */
export const OutboundJobSchema = z.object({
  /** Null for replies sent before a channel link exists (e.g. unlinked-user prompts). */
  userId: z.string().uuid().nullable(),
  channel: ChannelEnum,
  externalUserId: z.string().min(1),
  conversationId: z.string().min(1),
  text: z.string(),
  buttons: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        style: z.enum(['primary', 'danger']).optional(),
      }),
    )
    .optional(),
  /**
   * Idempotency key for the outbound send. Usually derived from the
   * triggering inbound idempotencyKey or alert delivery ID.
   */
  idempotencyKey: z.string().min(1),
  /** Optional pre-approved WhatsApp template name when target is outside the 24h window. */
  whatsappTemplate: z.string().optional(),
});
export type OutboundJob = z.infer<typeof OutboundJobSchema>;

export const QueueNames = {
  /** Inbound queues are partitioned: `inbound:0` … `inbound:N-1`. */
  inboundPrefix: 'inbound',
  outbound: 'outbound',
  outboundDLQ: 'outbound-dlq',
  /** Singleton scheduled jobs (prefetcher, alert engine). */
  scheduled: 'scheduled',
} as const;
