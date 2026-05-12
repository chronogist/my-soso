import { telegram } from '@my-soso/channels';
import { createDb, schema, withServiceContext } from '@my-soso/db';
import {
  createConnection,
  createQueue,
  inboundQueueFor,
  nextConversationSeq,
  type InboundJob,
  QueueNames,
  type OutboundJob,
  type Queue,
} from '@my-soso/queue';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';

/**
 * Pre-link placeholder is deliberately gone in Phase 2. Unlinked users get
 * a link prompt instead of entering the agent path anonymously.
 */
const inboundQueueCache = new Map<string, Queue<InboundJob>>();

const LinkCodePayloadSchema = z.object({
  userId: z.string().uuid(),
  channel: z.enum(['telegram', 'discord', 'whatsapp']),
  createdAt: z.string(),
});

function parseLinkCommand(text: string): string | null {
  // Alphabet must match LINK_ALPHABET in the API: 0/1/I/O are excluded to avoid
  // visual confusion. Codes are issued uppercase but accept lowercase input.
  const match = /^\/link(?:@\w+)?\s+([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})$/i.exec(text.trim());
  return match?.[1]?.toUpperCase() ?? null;
}

function parseLinkPayload(raw: string | null) {
  if (!raw) return null;
  try {
    return LinkCodePayloadSchema.safeParse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function registerTelegramWebhook(app: FastifyInstance, config: Config): void {
  const connection = createConnection({
    url: config.REDIS_URL,
    name: 'edge-telegram',
    onError: (err) => app.log.error({ err }, 'redis connection error'),
  });
  const db = createDb({ url: config.DATABASE_URL, max: 3 });
  const outboundQueue = createQueue<OutboundJob>(QueueNames.outbound, connection);

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
    await outboundQueue.close();
    await connection.quit();
  });

  const enqueueTelegramReply = async ({
    userId,
    externalUserId,
    conversationId,
    text,
    idempotencyKey,
  }: {
    userId: string | null;
    externalUserId: string;
    conversationId: string;
    text: string;
    idempotencyKey: string;
  }) => {
    await outboundQueue.add(
      'outbound',
      {
        userId,
        channel: 'telegram',
        externalUserId,
        conversationId,
        text,
        idempotencyKey,
      },
      { jobId: idempotencyKey },
    );
  };

  app.post('/webhooks/telegram', async (req, reply) => {
    const secret = req.headers[telegram.TELEGRAM_SECRET_HEADER];
    const received = Array.isArray(secret) ? secret[0] : secret;
    if (!telegram.verifyTelegramSecret({ received, expected: config.TELEGRAM_WEBHOOK_SECRET })) {
      req.log.warn('telegram webhook signature mismatch');
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const rawBody =
      typeof req.body === 'string'
        ? (() => {
            try {
              return JSON.parse(req.body) as unknown;
            } catch {
              return null;
            }
          })()
        : req.body;

    const parsed = telegram.TelegramUpdateSchema.safeParse(rawBody);
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
    const externalUserId = String(message.from.id);
    const idempotencyKey = `telegram-${parsed.data.update_id}`;
    const linkCode = parseLinkCommand(message.text);

    if (linkCode) {
      // Atomic read-and-delete prevents two concurrent /link redemptions
      // from both passing the existence check. After this call the code
      // is gone whether the DB write succeeds or not — on failure the
      // user is told to generate a fresh code.
      const raw = await connection.getdel(`link_code:${linkCode}`);
      const linkPayload = parseLinkPayload(raw);

      if (!linkPayload?.success || linkPayload.data.channel !== 'telegram') {
        await enqueueTelegramReply({
          userId: null,
          externalUserId,
          conversationId,
          text: 'That link code is expired or invalid. Open the My-Soso dashboard and generate a fresh Telegram code.',
          idempotencyKey: `link-failed-${idempotencyKey}`,
        });
        return reply.status(200).send({ ok: true });
      }

      try {
        await withServiceContext(db, async (tx) => {
          await tx
            .insert(schema.channelLinks)
            .values({
              userId: linkPayload.data.userId,
              channel: 'telegram',
              channelUserId: externalUserId,
            })
            .onConflictDoUpdate({
              target: [schema.channelLinks.userId, schema.channelLinks.channel],
              set: { channelUserId: externalUserId },
            });
        });
      } catch (err) {
        req.log.warn({ err }, 'telegram link failed');
        await enqueueTelegramReply({
          userId: linkPayload.data.userId,
          externalUserId,
          conversationId,
          text: 'I could not link this Telegram account. It may already be connected to another My-Soso account. Generate a fresh code from the dashboard and try again.',
          idempotencyKey: `link-conflict-${idempotencyKey}`,
        });
        return reply.status(200).send({ ok: true });
      }

      await enqueueTelegramReply({
        userId: linkPayload.data.userId,
        externalUserId,
        conversationId,
        text: '🐼 Nice — your Telegram is now connected to My-Soso Panda! 🐼 \n\nFrom here on, your panda buddy can help you keep up with your portfolio, market moves, watchlists, and crypto trends right inside Discord — powered by SosoValue data. 📊',
        idempotencyKey: `link-ok-${idempotencyKey}`,
      });
      req.log.info({ userId: linkPayload.data.userId }, 'telegram account linked');
      return reply.status(200).send({ ok: true });
    }

    const channelLink = await withServiceContext(db, async (tx) =>
      tx.query.channelLinks.findFirst({
        where: (channelLinks, { and, eq }) =>
          and(eq(channelLinks.channel, 'telegram'), eq(channelLinks.channelUserId, externalUserId)),
      }),
    );

    if (!channelLink) {
      await enqueueTelegramReply({
        userId: null,
        externalUserId,
        conversationId,
        text: '🐼 I am ready, but this Telegram chat is not linked yet. Sign in to the My-Soso dashboard, generate a Telegram code, then send /link CODE here.',
        idempotencyKey: `unlinked-${idempotencyKey}`,
      });
      return reply.status(200).send({ ok: true });
    }

    // Atomic INCR per conversation. Two Edge replicas posting concurrently
    // for the same chat get distinct, ordered seqNos with no coordination.
    // The Worker uses this to enforce strict FIFO regardless of retry timing.
    const seqNo = await nextConversationSeq(connection, conversationId);

    const job: InboundJob = {
      userId: channelLink.userId,
      channel: 'telegram',
      externalUserId,
      conversationId,
      text: message.text,
      idempotencyKey,
      seqNo,
      receivedAt: new Date(),
    };

    const queueName = inboundQueueFor(conversationId);
    await getQueue(queueName).add('inbound', job, { jobId: idempotencyKey });

    req.log.info({ queueName, conversationId, idempotencyKey, seqNo }, 'telegram inbound enqueued');
    return reply.status(200).send({ ok: true });
  });
}
