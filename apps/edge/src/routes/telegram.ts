import { telegram } from '@my-soso/channels';
import {
  createConnection,
  createQueue,
  inboundQueueFor,
  type InboundJob,
  type Queue,
} from '@my-soso/queue';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

/**
 * Pre-link placeholder userId. Real user resolution via the
 * `channel_links` table is wired in Phase 2 (auth + linking).
 */
const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

const inboundQueueCache = new Map<string, Queue<InboundJob>>();

export function registerTelegramWebhook(app: FastifyInstance, config: Config): void {
  const connection = createConnection({ url: config.REDIS_URL });

  const getQueue = (name: string): Queue<InboundJob> => {
    let q = inboundQueueCache.get(name);
    if (!q) {
      q = createQueue<InboundJob>(name, connection);
      inboundQueueCache.set(name, q);
    }
    return q;
  };

  app.addHook('onClose', async () => {
    await Promise.all([...inboundQueueCache.values()].map((q) => q.close()));
    await connection.quit();
  });

  app.post('/webhooks/telegram', async (req, reply) => {
    const secret = req.headers[telegram.TELEGRAM_SECRET_HEADER];
    const received = Array.isArray(secret) ? secret[0] : secret;
    if (!telegram.verifyTelegramSecret({ received, expected: config.TELEGRAM_WEBHOOK_SECRET })) {
      req.log.warn('telegram webhook signature mismatch');
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const parsed = telegram.TelegramUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ issues: parsed.error.issues }, 'telegram update parse failed');
      return reply.status(400).send({ error: 'invalid payload' });
    }

    const message = telegram.extractInboundMessage(parsed.data);
    if (!message?.text || !message.from) {
      // Non-text update (sticker, system message, etc.) — ack and ignore.
      return reply.status(200).send({ ok: true });
    }

    // Wave 1 only handles 1:1 personal-finance conversations. Group/channel
    // posts are intentionally ignored to avoid surprising broadcast behaviour
    // and to keep watchlists scoped to a single user.
    if (message.chat.type !== 'private') {
      req.log.info({ chatType: message.chat.type }, 'telegram non-private chat ignored');
      return reply.status(200).send({ ok: true });
    }

    const conversationId = String(message.chat.id);
    const idempotencyKey = `telegram:${parsed.data.update_id}`;

    const job: InboundJob = {
      userId: ANONYMOUS_USER_ID,
      channel: 'telegram',
      externalUserId: String(message.from.id),
      conversationId,
      text: message.text,
      idempotencyKey,
      receivedAt: new Date(),
    };

    const queueName = inboundQueueFor(conversationId);
    await getQueue(queueName).add('inbound', job, { jobId: idempotencyKey });

    req.log.info({ queueName, conversationId, idempotencyKey }, 'telegram inbound enqueued');
    return reply.status(200).send({ ok: true });
  });
}
