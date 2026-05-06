import { telegram } from '@my-soso/channels';
import {
  createWorker,
  OutboundJobSchema,
  QueueNames,
  type OutboundJob,
  type Redis,
  type Worker,
} from '@my-soso/queue';
import type { Logger } from 'pino';
import { withSentry } from '../sentry.js';

export interface OutboundConsumerHandles {
  worker: Worker<OutboundJob>;
  close: () => Promise<void>;
}

export interface StartOutboundConsumerOptions {
  connection: Redis;
  log: Logger;
  telegramBotToken: string;
}

/**
 * Consume outbound replies and ship them to the right channel. Failures
 * use BullMQ's exponential backoff retries (configured in the queue
 * factory). After max attempts a job lands in BullMQ's failed set; an
 * outbound DLQ is wired in a later commit.
 */
export function startOutboundConsumer({
  connection,
  log,
  telegramBotToken,
}: StartOutboundConsumerOptions): OutboundConsumerHandles {
  const worker = createWorker<OutboundJob, void>({
    name: QueueNames.outbound,
    connection,
    processor: (job) =>
      withSentry('outbound', async () => {
        const parsed = OutboundJobSchema.safeParse(job.data);
        if (!parsed.success) {
          // Throw so BullMQ retries; truly poisoned jobs land in DLQ.
          log.error({ jobId: job.id, issues: parsed.error.issues }, 'invalid outbound job');
          throw new Error('invalid outbound job payload');
        }
        const out = parsed.data;

        switch (out.channel) {
          case 'telegram': {
            const buttons = out.buttons?.map((b) => ({ id: b.id, label: b.label }));
            const result = await telegram.sendTelegramMessage({
              botToken: telegramBotToken,
              chatId: out.conversationId,
              text: out.text,
              ...(buttons && buttons.length > 0 ? { buttons } : {}),
            });
            if (!result.ok) {
              log.error({ jobId: job.id, description: result.description }, 'telegram send failed');
              throw new Error(result.description ?? 'telegram send failed');
            }
            log.info({ jobId: job.id, messageId: result.message_id }, 'telegram send ok');
            return;
          }
          case 'discord':
          case 'whatsapp':
            log.warn({ channel: out.channel }, 'channel adapter not yet implemented');
            return;
        }
      }),
  });

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
