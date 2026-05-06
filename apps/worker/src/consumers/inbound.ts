import {
  acquireLock,
  allInboundQueueNames,
  conversationLockKey,
  createQueue,
  createWorker,
  InboundJobSchema,
  QueueNames,
  type InboundJob,
  type OutboundJob,
  type Queue,
  type Redis,
  type Worker,
} from '@my-soso/queue';
import type { Logger } from 'pino';
import { handleCommand } from '../commands.js';
import { withSentry } from '../sentry.js';

export interface InboundConsumerHandles {
  workers: Worker<InboundJob>[];
  outboundQueue: Queue<OutboundJob>;
  close: () => Promise<void>;
}

/**
 * Per-conversation lock TTL. Long enough to outlast normal processing
 * (LLM calls, DB writes), short enough that a crashed worker doesn't
 * block the conversation forever.
 */
const CONVERSATION_LOCK_TTL_MS = 30_000;

/**
 * Spawn one BullMQ Worker per inbound partition with `concurrency: 1`.
 *
 * Per-conversation ordering is guaranteed by two layers:
 *   1. Hash partitioning routes same-conversation jobs to the same queue.
 *   2. A Redis lock keyed on conversationId serialises processing across
 *      multiple Worker pods (concurrency:1 alone is not enough — separate
 *      replicas could each pull a different same-conversation job).
 *
 * If the lock can't be acquired, the job is thrown back to the queue and
 * retried with backoff — another worker is already handling that
 * conversation, so we yield.
 */
export function startInboundConsumer({
  connection,
  log,
}: {
  connection: Redis;
  log: Logger;
}): InboundConsumerHandles {
  const outboundQueue = createQueue<OutboundJob>(QueueNames.outbound, connection);
  const queueNames = allInboundQueueNames();

  const workers = queueNames.map((name) =>
    createWorker<InboundJob, void>({
      name,
      connection,
      concurrency: 1,
      processor: (job) =>
        withSentry('inbound', async () => {
          const parsed = InboundJobSchema.safeParse(job.data);
          if (!parsed.success) {
            // Throw so BullMQ retries; truly poisoned jobs land in DLQ.
            log.error({ jobId: job.id, issues: parsed.error.issues }, 'invalid inbound job');
            throw new Error('invalid inbound job payload');
          }
          const inbound = parsed.data;

          const lock = await acquireLock(connection, {
            key: conversationLockKey(inbound.conversationId),
            ttlMs: CONVERSATION_LOCK_TTL_MS,
          });
          if (!lock) {
            log.info(
              { jobId: job.id, conversationId: inbound.conversationId },
              'conversation locked elsewhere, retrying',
            );
            throw new Error('conversation_locked');
          }

          try {
            log.info(
              { jobId: job.id, conversationId: inbound.conversationId, channel: inbound.channel },
              'inbound received',
            );

            const command = handleCommand(inbound);
            // The agent replaces this fallback in a later phase.
            const replyText = command?.text ?? `(agent reply pending) you said: ${inbound.text}`;

            const outbound: OutboundJob = {
              userId: inbound.userId,
              channel: inbound.channel,
              externalUserId: inbound.externalUserId,
              conversationId: inbound.conversationId,
              text: replyText,
              idempotencyKey: `reply:${inbound.idempotencyKey}`,
            };

            await outboundQueue.add('outbound', outbound, { jobId: outbound.idempotencyKey });
          } finally {
            await lock.release();
          }
        }),
    }),
  );

  return {
    workers,
    outboundQueue,
    close: async () => {
      await Promise.allSettled(workers.map((w) => w.close()));
      await outboundQueue.close();
    },
  };
}
