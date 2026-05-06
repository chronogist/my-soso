import {
  allInboundQueueNames,
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

export interface InboundConsumerHandles {
  workers: Worker<InboundJob>[];
  outboundQueue: Queue<OutboundJob>;
  close: () => Promise<void>;
}

/**
 * Spawn one BullMQ Worker per inbound partition. Each consumes jobs in
 * FIFO order within its partition, giving per-conversation ordering
 * because same-conversation jobs always hash to the same partition.
 *
 * For now the reply is hardcoded ("pong" + echo). Subsequent commits
 * will replace this with the real Agent (LLM + tools).
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
      processor: async (job) => {
        const parsed = InboundJobSchema.safeParse(job.data);
        if (!parsed.success) {
          log.error({ jobId: job.id, issues: parsed.error.issues }, 'invalid inbound job');
          return;
        }
        const inbound = parsed.data;
        log.info(
          { jobId: job.id, conversationId: inbound.conversationId, channel: inbound.channel },
          'inbound received',
        );

        const replyText = inbound.text === '/start' ? 'pong' : `echo: ${inbound.text}`;

        const outbound: OutboundJob = {
          userId: inbound.userId,
          channel: inbound.channel,
          externalUserId: inbound.externalUserId,
          conversationId: inbound.conversationId,
          text: replyText,
          idempotencyKey: `reply:${inbound.idempotencyKey}`,
        };

        await outboundQueue.add('outbound', outbound, { jobId: outbound.idempotencyKey });
      },
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
