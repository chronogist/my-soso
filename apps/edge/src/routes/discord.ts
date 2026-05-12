import { discord } from '@my-soso/channels';
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

export function registerDiscordWebhook(app: FastifyInstance, config: Config): void {
  if (!config.DISCORD_PUBLIC_KEY) return;

  const connection = createConnection({
    url: config.REDIS_URL,
    name: 'edge-discord',
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

  app.post('/webhooks/discord', async (req, reply) => {
    const rawBody = typeof req.body === 'string' ? req.body : '';
    const signature = req.headers[discord.DISCORD_SIGNATURE_HEADER];
    const timestamp = req.headers[discord.DISCORD_TIMESTAMP_HEADER];
    const receivedSignature = Array.isArray(signature) ? signature[0] : signature;
    const receivedTimestamp = Array.isArray(timestamp) ? timestamp[0] : timestamp;

    if (
      !discord.verifyDiscordSignature({
        publicKey: config.DISCORD_PUBLIC_KEY!,
        signature: receivedSignature,
        timestamp: receivedTimestamp,
        rawBody,
      })
    ) {
      req.log.warn('discord webhook signature mismatch');
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const rawJson = parseRawJson(req.body);
    const parsed = discord.DiscordInteractionSchema.safeParse(rawJson);
    if (!parsed.success) {
      req.log.warn({ issues: parsed.error.issues }, 'discord interaction parse failed');
      return reply.status(400).send({ error: 'invalid payload' });
    }

    const interaction = parsed.data;

    if (interaction.type === discord.DISCORD_INTERACTION.PING) {
      return reply.status(200).send({ type: discord.DISCORD_RESPONSE.PONG });
    }

    if (interaction.type !== discord.DISCORD_INTERACTION.APPLICATION_COMMAND) {
      return reply.status(200).send({
        type: discord.DISCORD_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'That Discord interaction is not supported yet.' },
      });
    }

    const externalUserId = discord.interactionUserId(interaction);
    const text = discord.slashCommandText(interaction);
    const commandName = interaction.data?.name?.toLowerCase();
    const conversationId = interaction.channel_id ?? externalUserId ?? interaction.id;
    const idempotencyKey = `discord-${interaction.id}`;

    if (!externalUserId || !text) {
      return reply.status(200).send({
        type: discord.DISCORD_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'I could not read that command payload.' },
      });
    }

    if (
      commandName !== 'ask' &&
      commandName !== 'link' &&
      commandName !== 'watch' &&
      commandName !== 'alert' &&
      commandName !== 'memo'
    ) {
      return reply.status(200).send({
        type: discord.DISCORD_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `/${commandName} is not wired yet. /ask, /watch, /alert, /memo, and /link are live first.`,
        },
      });
    }

    if (commandName === 'link') {
      const linkCode = /^\/link\s+([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})$/i
        .exec(text)?.[1]
        ?.toUpperCase();
      void (async () => {
        const raw = linkCode ? await connection.getdel(`link_code:${linkCode}`) : null;
        const linkPayload = parseLinkPayload(raw);

        const sendFollowup = async (text: string, id: string, userId: string | null) => {
          await outboundQueue.add(
            'outbound',
            {
              userId,
              channel: 'discord',
              externalUserId,
              conversationId,
              text,
              discordApplicationId: interaction.application_id,
              discordInteractionToken: interaction.token,
              idempotencyKey: id,
            },
            { jobId: id },
          );
        };

        if (!linkPayload?.success || linkPayload.data.channel !== 'discord') {
          await sendFollowup(
            '🐼 That link code is expired or invalid. Generate a fresh Discord code in the dashboard.',
            `link-failed-${idempotencyKey}`,
            null,
          );
          return;
        }

        try {
          await withServiceContext(db, async (tx) => {
            await tx
              .insert(schema.channelLinks)
              .values({
                userId: linkPayload.data.userId,
                channel: 'discord',
                channelUserId: externalUserId,
              })
              .onConflictDoUpdate({
                target: [schema.channelLinks.userId, schema.channelLinks.channel],
                set: { channelUserId: externalUserId },
              });
          });
        } catch (err) {
          req.log.warn({ err }, 'discord link failed');
          await sendFollowup(
            '🐼 I could not link this Discord account. It may already be connected somewhere else. Generate a fresh code and try again.',
            `link-conflict-${idempotencyKey}`,
            linkPayload.data.userId,
          );
          return;
        }

        req.log.info({ userId: linkPayload.data.userId }, 'discord account linked');
        await sendFollowup(
          '🐼 Discord is linked. Your My-Soso Panda now knows this account belongs to you.',
          `link-ok-${idempotencyKey}`,
          linkPayload.data.userId,
        );
      })().catch((err) => req.log.warn({ err }, 'discord link followup failed'));

      return reply.status(200).send({
        type: discord.DISCORD_RESPONSE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });
    }

    const channelLink = await withServiceContext(db, async (tx) =>
      tx.query.channelLinks.findFirst({
        where: (channelLinks, { and, eq }) =>
          and(eq(channelLinks.channel, 'discord'), eq(channelLinks.channelUserId, externalUserId)),
      }),
    );

    if (!channelLink) {
      return reply.status(200).send({
        type: discord.DISCORD_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content:
            '🐼 I am ready, but this Discord account is not linked yet. Sign in to the My-Soso dashboard, generate a Discord code, then run /link CODE here.',
        },
      });
    }

    const seqNo = await nextConversationSeq(connection, conversationId);
    const job: InboundJob = {
      userId: channelLink.userId,
      channel: 'discord',
      externalUserId,
      conversationId,
      text,
      discordApplicationId: interaction.application_id,
      discordInteractionToken: interaction.token,
      idempotencyKey,
      seqNo,
      receivedAt: new Date(),
    };

    const queueName = inboundQueueFor(conversationId);
    await getQueue(queueName).add('inbound', job, { jobId: idempotencyKey });

    req.log.info({ queueName, conversationId, idempotencyKey, seqNo }, 'discord inbound enqueued');
    return reply.status(200).send({
      type: discord.DISCORD_RESPONSE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
  });
}
