import { whatsapp } from '@my-soso/channels';
import { createDb, schema, withServiceContext } from '@my-soso/db';
import {
  createConnection,
  createQueue,
  inboundQueueFor,
  nextConversationSeq,
  QueueNames,
  type InboundJob,
  type OutboundJob,
  type Queue,
} from '@my-soso/queue';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';

const inboundQueueCache = new Map<string, Queue<InboundJob>>();

const LinkCodePayloadSchema = z.object({
  userId: z.string().uuid(),
  channel: z.enum(['telegram', 'discord', 'whatsapp']),
  createdAt: z.string(),
});

function parseRawJson(body: unknown) {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function parseLinkPayload(raw: string | null) {
  if (!raw) return null;
  try {
    return LinkCodePayloadSchema.safeParse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function parseLinkCommand(text: string): string | null {
  const match = /^\/link\s+([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})$/i.exec(text.trim());
  return match?.[1]?.toUpperCase() ?? null;
}

export function registerWhatsAppWebhook(app: FastifyInstance, config: Config): void {
  if (!config.WHATSAPP_VERIFY_TOKEN || !config.WHATSAPP_APP_SECRET) return;

  const connection = createConnection({
    url: config.REDIS_URL,
    name: 'edge-whatsapp',
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

  app.get('/webhooks/whatsapp', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const mode = query['hub.mode'];
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (
      !whatsapp.verifyWhatsAppChallenge({
        mode,
        verifyToken,
        expectedToken: config.WHATSAPP_VERIFY_TOKEN!,
      })
    ) {
      return reply.status(403).send({ error: 'forbidden' });
    }

    return reply
      .status(200)
      .type('text/plain')
      .send(challenge ?? '');
  });

  app.post('/webhooks/whatsapp', async (req, reply) => {
    const rawBody = typeof req.body === 'string' ? req.body : '';
    const signature = req.headers[whatsapp.WHATSAPP_SIGNATURE_HEADER];
    const receivedSignature = Array.isArray(signature) ? signature[0] : signature;

    if (
      !whatsapp.verifyWhatsAppSignature({
        appSecret: config.WHATSAPP_APP_SECRET!,
        signature: receivedSignature,
        rawBody,
      })
    ) {
      req.log.warn('whatsapp webhook signature mismatch');
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const rawJson = parseRawJson(req.body);
    const parsed = whatsapp.WhatsAppWebhookSchema.safeParse(rawJson);
    if (!parsed.success) {
      req.log.warn({ issues: parsed.error.issues }, 'whatsapp payload parse failed');
      return reply.status(400).send({ error: 'invalid payload' });
    }

    const inboundMessages = whatsapp.extractInboundWhatsAppMessages(parsed.data);
    if (inboundMessages.length === 0) {
      return reply.status(200).send({ ok: true });
    }

    for (const inbound of inboundMessages) {
      if (inbound.message.type !== 'text' || !inbound.message.text?.body) continue;

      const text = inbound.message.text.body;
      const externalUserId = inbound.message.from;
      const conversationId = inbound.conversationId;
      const idempotencyKey = `whatsapp-${inbound.message.id}`;
      const linkCode = parseLinkCommand(text);

      if (linkCode) {
        const raw = await connection.getdel(`link_code:${linkCode}`);
        const linkPayload = parseLinkPayload(raw);

        if (!linkPayload?.success || linkPayload.data.channel !== 'whatsapp') {
          await outboundQueue.add(
            'outbound',
            {
              userId: null,
              channel: 'whatsapp',
              externalUserId,
              conversationId,
              text: 'That link code is expired or invalid. Open the My-Soso dashboard and generate a fresh WhatsApp code.',
              idempotencyKey: `link-failed-${idempotencyKey}`,
              whatsappTemplate: 'link_confirmation',
            },
            { jobId: `link-failed-${idempotencyKey}` },
          );
          continue;
        }

        try {
          await withServiceContext(db, async (tx) => {
            await tx
              .insert(schema.channelLinks)
              .values({
                userId: linkPayload.data.userId,
                channel: 'whatsapp',
                channelUserId: externalUserId,
              })
              .onConflictDoUpdate({
                target: [schema.channelLinks.userId, schema.channelLinks.channel],
                set: { channelUserId: externalUserId },
              });
          });
        } catch (err) {
          req.log.warn({ err }, 'whatsapp link failed');
          await outboundQueue.add(
            'outbound',
            {
              userId: linkPayload.data.userId,
              channel: 'whatsapp',
              externalUserId,
              conversationId,
              text: 'I could not link this WhatsApp account. It may already be connected elsewhere. Generate a fresh code and try again.',
              idempotencyKey: `link-conflict-${idempotencyKey}`,
              whatsappTemplate: 'link_confirmation',
            },
            { jobId: `link-conflict-${idempotencyKey}` },
          );
          continue;
        }

        await outboundQueue.add(
          'outbound',
          {
            userId: linkPayload.data.userId,
            channel: 'whatsapp',
            externalUserId,
            conversationId,
            text: 'WhatsApp is linked. Your My-Soso agent now knows this chat belongs to you.',
            idempotencyKey: `link-ok-${idempotencyKey}`,
          },
          { jobId: `link-ok-${idempotencyKey}` },
        );
        continue;
      }

      const channelLink = await withServiceContext(db, async (tx) =>
        tx.query.channelLinks.findFirst({
          where: (channelLinks, { and, eq }) =>
            and(
              eq(channelLinks.channel, 'whatsapp'),
              eq(channelLinks.channelUserId, externalUserId),
            ),
        }),
      );

      if (!channelLink) {
        await outboundQueue.add(
          'outbound',
          {
            userId: null,
            channel: 'whatsapp',
            externalUserId,
            conversationId,
            text: 'I am ready, but this WhatsApp number is not linked yet. Sign in to the My-Soso dashboard, generate a WhatsApp code, then send /link CODE here.',
            idempotencyKey: `unlinked-${idempotencyKey}`,
            whatsappTemplate: 'link_confirmation',
          },
          { jobId: `unlinked-${idempotencyKey}` },
        );
        continue;
      }

      const seqNo = await nextConversationSeq(connection, conversationId);
      const job: InboundJob = {
        userId: channelLink.userId,
        channel: 'whatsapp',
        externalUserId,
        conversationId,
        text,
        idempotencyKey,
        seqNo,
        receivedAt: new Date(),
      };

      const queueName = inboundQueueFor(conversationId);
      await getQueue(queueName).add('inbound', job, { jobId: idempotencyKey });
      req.log.info(
        { queueName, conversationId, idempotencyKey, seqNo },
        'whatsapp inbound enqueued',
      );
    }

    return reply.status(200).send({ ok: true });
  });
}
