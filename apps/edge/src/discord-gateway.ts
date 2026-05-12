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
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';

const inboundQueueCache = new Map<string, Queue<InboundJob>>();

const LinkCodePayloadSchema = z.object({
  userId: z.string().uuid(),
  channel: z.enum(['telegram', 'discord', 'whatsapp']),
  createdAt: z.string(),
});

function parseLinkPayload(raw: string | null) {
  if (!raw) return null;
  try {
    return LinkCodePayloadSchema.safeParse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function parseLinkMessage(text: string): string | null {
  const match = /^\/?link\s+([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})$/i.exec(text.trim());
  return match?.[1]?.toUpperCase() ?? null;
}

function defaultIntents(): number {
  const GUILDS = 1 << 0;
  const GUILD_MESSAGES = 1 << 9;
  const DIRECT_MESSAGES = 1 << 12;
  const MESSAGE_CONTENT = 1 << 15;
  return GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT;
}

type DiscordGatewayFrame = {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
};

type DiscordHello = { heartbeat_interval: number };

export function startDiscordGatewayListener(config: Config, log: FastifyBaseLogger): {
  close: () => Promise<void>;
} | null {
  const botToken = config.DISCORD_BOT_TOKEN;
  if (!botToken) return null;

  const enable =
    config.NODE_ENV !== 'production' &&
    (config.DISCORD_GATEWAY_ENABLED ?? true) &&
    Boolean(botToken);
  if (!enable) return null;

  const connection = createConnection({
    url: config.REDIS_URL,
    name: 'edge-discord-gateway',
    onError: (err) => log.error({ err }, 'redis connection error'),
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

  const enqueueDiscordReply = async ({
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
        channel: 'discord',
        externalUserId,
        conversationId,
        text,
        idempotencyKey,
      },
      { jobId: idempotencyKey },
    );
  };

  let ws: any = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let seq: number | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = async () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      ws?.close?.();
    } catch {
    }
    await Promise.all([...inboundQueueCache.values()].map((q) => q.close()));
    inboundQueueCache.clear();
    await outboundQueue.close();
    await connection.quit();
  };

  const send = (frame: unknown) => {
    try {
      ws?.send?.(JSON.stringify(frame));
    } catch {
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  };

  const handleMessageCreate = async (payload: any) => {
    const channelId = payload?.channel_id;
    const content = typeof payload?.content === 'string' ? payload.content : '';
    const authorId = payload?.author?.id;
    const isBot = Boolean(payload?.author?.bot);
    const messageId = payload?.id;

    if (!channelId || !authorId || isBot || !messageId) return;
    if (!content.trim()) return;

    const conversationId = String(channelId);
    const externalUserId = String(authorId);
    const idempotencyKey = `discordmsg-${messageId}`;

    const linkCode = parseLinkMessage(content);
    if (linkCode) {
      const raw = await connection.getdel(`link_code:${linkCode}`);
      const linkPayload = parseLinkPayload(raw);

      if (!linkPayload?.success || linkPayload.data.channel !== 'discord') {
        await enqueueDiscordReply({
          userId: null,
          externalUserId,
          conversationId,
          text: '🐼 That link code is expired or invalid. Generate a fresh Discord code in the dashboard.',
          idempotencyKey: `link-failed-${idempotencyKey}`,
        });
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
        log.warn({ err }, 'discord gateway link failed');
        await enqueueDiscordReply({
          userId: linkPayload.data.userId,
          externalUserId,
          conversationId,
          text: '🐼 I could not link this Discord account. It may already be connected somewhere else. Generate a fresh code and try again.',
          idempotencyKey: `link-conflict-${idempotencyKey}`,
        });
        return;
      }

      await enqueueDiscordReply({
        userId: linkPayload.data.userId,
        externalUserId,
        conversationId,
        text: '🐼 Discord is linked. You can just message me normally now.',
        idempotencyKey: `link-ok-${idempotencyKey}`,
      });
      log.info({ userId: linkPayload.data.userId }, 'discord account linked (gateway)');
      return;
    }

    const channelLink = await withServiceContext(db, async (tx) =>
      tx.query.channelLinks.findFirst({
        where: (channelLinks, { and, eq }) =>
          and(eq(channelLinks.channel, 'discord'), eq(channelLinks.channelUserId, externalUserId)),
      }),
    );

    if (!channelLink) {
      await enqueueDiscordReply({
        userId: null,
        externalUserId,
        conversationId,
        text: '🐼 I am ready, but this Discord account is not linked yet. Sign in to the My-Soso dashboard, generate a Discord code, then send: link CODE',
        idempotencyKey: `unlinked-${idempotencyKey}`,
      });
      return;
    }

    const seqNo = await nextConversationSeq(connection, conversationId);
    const job: InboundJob = {
      userId: channelLink.userId,
      channel: 'discord',
      externalUserId,
      conversationId,
      text: content,
      idempotencyKey,
      seqNo,
      receivedAt: new Date(),
    };

    const queueName = inboundQueueFor(conversationId);
    await getQueue(queueName).add('inbound', job, { jobId: idempotencyKey });
    log.info({ queueName, conversationId, idempotencyKey, seqNo }, 'discord inbound enqueued (gateway)');
  };

  const onFrame = async (frame: DiscordGatewayFrame) => {
    if (typeof frame.s === 'number') seq = frame.s;

    if (frame.op === 10) {
      const hello = frame.d as DiscordHello;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        send({ op: 1, d: seq });
      }, hello.heartbeat_interval);
      send({ op: 1, d: seq });
      const intents = config.DISCORD_GATEWAY_INTENTS ?? defaultIntents();
      send({
        op: 2,
        d: {
          token: botToken,
          intents,
          properties: {
            os: process.platform,
            browser: 'my-soso',
            device: 'my-soso',
          },
        },
      });
      return;
    }

    if (frame.op === 7 || frame.op === 9) {
      try {
        ws?.close?.();
      } catch {
      }
      return;
    }

    if (frame.op === 0 && frame.t === 'MESSAGE_CREATE') {
      await handleMessageCreate(frame.d as any);
    }
  };

  const connect = () => {
    if (closed) return;
    const WebSocketImpl = (globalThis as any).WebSocket;
    if (!WebSocketImpl) {
      log.error('discord gateway unavailable: WebSocket is not defined in this runtime');
      return;
    }

    seq = null;
    ws = new WebSocketImpl('wss://gateway.discord.gg/?v=10&encoding=json');

    ws.onopen = () => {
      log.info('discord gateway connected');
    };

    ws.onclose = () => {
      log.warn('discord gateway disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      scheduleReconnect();
    };

    ws.onmessage = (ev: any) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as DiscordGatewayFrame;
        void onFrame(parsed);
      } catch {
      }
    };
  };

  connect();

  return { close: stop };
}
