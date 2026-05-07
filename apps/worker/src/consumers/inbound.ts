import {
  acquireLock,
  advanceProcessedSeq,
  allInboundQueueNames,
  conversationLockKey,
  createQueue,
  createWorker,
  InboundJobSchema,
  lastProcessedSeq,
  QueueNames,
  type InboundJob,
  type OutboundJob,
  type Queue,
  type Redis,
  type Worker,
} from '@my-soso/queue';
import type { Logger } from 'pino';
import { handleCommand } from '../commands.js';
import type { Agent } from '../agent/agent.js';
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
 * Per-conversation FIFO is guaranteed by **two** mechanisms working
 * together:
 *
 *   1. **Sequence guard** — Edge stamps each inbound message with a
 *      strictly monotonic per-conversation seqNo. The Worker only
 *      processes when `job.seqNo == lastProcessed + 1`; otherwise it
 *      throws and the job is requeued with backoff. This makes ordering
 *      independent of retry timing, lock TTL expiry, or replica count.
 *
 *   2. **Conversation lock** — mutual exclusion guard for the rare
 *      case where two replicas race on the same seqNo (e.g. a job that
 *      was redelivered after worker death). The lock is non-essential
 *      for correctness given the seq guard but cheap and worth keeping.
 *
 * The lock TTL can in theory expire mid-LLM-call. If that happens, the
 * sequence guard still prevents another worker from processing
 * out-of-order — they'd see `lastProcessed` is unchanged and refuse the
 * next seqNo until ours completes (which advances it).
 */
export function startInboundConsumer({
  connection,
  log,
  agent,
}: {
  connection: Redis;
  log: Logger;
  agent: Agent;
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
            log.error({ jobId: job.id, issues: parsed.error.issues }, 'invalid inbound job');
            throw new Error('invalid inbound job payload');
          }
          const inbound = parsed.data;

          // ─── Sequence guard ────────────────────────────────────────
          const lastSeq = await lastProcessedSeq(connection, inbound.conversationId);
          if (inbound.seqNo !== lastSeq + 1) {
            log.info(
              {
                jobId: job.id,
                conversationId: inbound.conversationId,
                seqNo: inbound.seqNo,
                lastSeq,
              },
              'out of order, will retry',
            );
            throw new Error(`out_of_order: have ${inbound.seqNo}, expected ${lastSeq + 1}`);
          }

          // ─── Mutual exclusion lock (defense-in-depth) ──────────────
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
              {
                jobId: job.id,
                conversationId: inbound.conversationId,
                channel: inbound.channel,
                seqNo: inbound.seqNo,
              },
              'inbound received',
            );

            const command = handleCommand(inbound);
            let replyText: string;
            if (command) {
              replyText = command.text;
            } else {
              try {
                const result = await agent.run({
                  userMessage: inbound.text,
                  conversationId: inbound.conversationId,
                });
                replyText = result.text;
              } catch (err) {
                // Agent failures must not block the FIFO sequence. Reply with
                // an honest apology and advance the seqNo so the next user
                // message can flow.
                log.error(
                  {
                    err,
                    jobId: job.id,
                    conversationId: inbound.conversationId,
                  },
                  'agent run failed',
                );
                replyText =
                  "I'm having trouble reaching my data right now. Please try again in a moment.";
              }
            }

            const outbound: OutboundJob = {
              userId: inbound.userId,
              channel: inbound.channel,
              externalUserId: inbound.externalUserId,
              conversationId: inbound.conversationId,
              text: replyText,
              idempotencyKey: `reply:${inbound.idempotencyKey}`,
            };

            await outboundQueue.add('outbound', outbound, { jobId: outbound.idempotencyKey });

            // Advance the processed counter ATOMICALLY only if it's still
            // exactly `lastSeq + 1`. If a parallel worker somehow advanced
            // it (shouldn't be possible given the lock, but defense in
            // depth), we throw rather than corrupt the counter.
            const advanced = await advanceProcessedSeq(
              connection,
              inbound.conversationId,
              inbound.seqNo,
            );
            if (!advanced) {
              throw new Error('processed_seq_drift');
            }
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
