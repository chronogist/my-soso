import { discord, telegram, whatsapp } from '@my-soso/channels';
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
  discordBotToken?: string;
  whatsappAccessToken?: string;
  whatsappPhoneNumberId?: string;
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
  discordBotToken,
  whatsappAccessToken,
  whatsappPhoneNumberId,
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
            if (out.discordApplicationId && out.discordInteractionToken) {
              const result = await discord.sendDiscordFollowupMessage({
                applicationId: out.discordApplicationId,
                interactionToken: out.discordInteractionToken,
                text: out.text,
              });
              if (!result.ok) {
                log.error(
                  { jobId: job.id, description: result.description },
                  'discord send failed',
                );
                throw new Error(result.description);
              }
              log.info({ jobId: job.id }, 'discord send ok');
              return;
            }
            if (!discordBotToken) {
              log.error({ jobId: job.id }, 'discord outbound missing bot token');
              throw new Error('discord outbound missing bot token');
            }
            {
              const result = await discord.sendDiscordChannelMessage({
                botToken: discordBotToken,
                channelId: out.conversationId,
                text: out.text,
              });
              if (!result.ok) {
                log.error(
                  { jobId: job.id, description: result.description },
                  'discord send failed',
                );
                throw new Error(result.description);
              }
              log.info({ jobId: job.id }, 'discord send ok');
              return;
            }
          case 'whatsapp':
            if (!whatsappAccessToken || !whatsappPhoneNumberId) {
              log.error({ jobId: job.id }, 'whatsapp config missing');
              throw new Error('whatsapp config missing');
            }
            {
              const template =
                out.whatsappTemplate === undefined ? {} : { templateName: out.whatsappTemplate };
              const result = await whatsapp.sendWhatsAppMessage({
                accessToken: whatsappAccessToken,
                phoneNumberId: whatsappPhoneNumberId,
                to: out.externalUserId,
                text: out.text,
                ...template,
              });
              if (!result.ok) {
                log.error(
                  { jobId: job.id, description: result.description },
                  'whatsapp send failed',
                );
                throw new Error(result.description);
              }
              log.info({ jobId: job.id }, 'whatsapp send ok');
              return;
            }
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
