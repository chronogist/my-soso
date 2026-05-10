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
import type { Database } from '@my-soso/db';
import { discord, telegram } from '@my-soso/channels';
import { handleCommand } from '../commands.js';
import type { Agent, RunAgentResult } from '../agent/agent.js';
import { writeAuditEntry } from '../agent/audit.js';
import type { AuditClassification, ComplianceClassifier } from '../agent/compliance.js';
import { loadUserPreferences } from '../preferences.js';
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
  compliance,
  db,
  agentModelId,
  telegramBotToken,
  discordBotToken,
}: {
  connection: Redis;
  log: Logger;
  agent: Agent;
  compliance: ComplianceClassifier;
  db: Database;
  agentModelId: string;
  /** Optional. When set, the worker fires the Telegram "typing…"
   * indicator while processing inbound Telegram messages and refreshes
   * it every 4 seconds until the reply is enqueued. */
  telegramBotToken?: string | undefined;
  discordBotToken?: string | undefined;
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
            let classification: AuditClassification = 'market_info';
            let auditedResult: RunAgentResult | undefined;
            if (command) {
              replyText = command.text;
            } else {
              // Show "typing…" in Telegram while the agent works. The
              // indicator auto-clears after ~5s server-side, so we
              // refresh it every 4s until the agent run resolves.
              // Failures are silent (sendTelegramChatAction swallows).
              let telegramTypingTimer: ReturnType<typeof setInterval> | null = null;
              let discordTypingTimer: ReturnType<typeof setInterval> | null = null;
              if (inbound.channel === 'telegram' && telegramBotToken) {
                void telegram.sendTelegramChatAction({
                  botToken: telegramBotToken,
                  chatId: inbound.conversationId,
                });
                telegramTypingTimer = setInterval(() => {
                  void telegram.sendTelegramChatAction({
                    botToken: telegramBotToken,
                    chatId: inbound.conversationId,
                  });
                }, 4000);
              }
              if (inbound.channel === 'discord' && discordBotToken) {
                void discord.sendDiscordTyping({
                  botToken: discordBotToken,
                  channelId: inbound.conversationId,
                });
                discordTypingTimer = setInterval(() => {
                  void discord.sendDiscordTyping({
                    botToken: discordBotToken,
                    channelId: inbound.conversationId,
                  });
                }, 7000);
              }
              try {
                const prefs = await loadUserPreferences(db, inbound.userId);
                const channelTone = prefs.channelOverrides?.[inbound.channel]?.tone;
                const result = await agent.run({
                  userMessage: inbound.text,
                  conversationId: inbound.conversationId,
                  userId: inbound.userId,
                  tone: channelTone ?? prefs.tone,
                  verbosity: prefs.verbosity,
                  language: prefs.language,
                });
                const review = await compliance.review({
                  userMessage: inbound.text,
                  assistantReply: result.text,
                  conversationId: inbound.conversationId,
                });
                replyText = review.responseText;
                classification = review.classification;
                auditedResult = {
                  ...result,
                  text: replyText,
                  finishReason: review.sanitized ? 'compliance_rewrite' : result.finishReason,
                };
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
                await writeAuditEntry({
                  db,
                  log,
                  inbound,
                  modelId: agentModelId,
                  errorMessage: err instanceof Error ? err.message : String(err),
                });
              } finally {
                if (telegramTypingTimer) clearInterval(telegramTypingTimer);
                if (discordTypingTimer) clearInterval(discordTypingTimer);
              }
            }

            const outbound: OutboundJob = {
              userId: inbound.userId,
              channel: inbound.channel,
              externalUserId: inbound.externalUserId,
              conversationId: inbound.conversationId,
              text: replyText,
              ...(inbound.discordApplicationId
                ? { discordApplicationId: inbound.discordApplicationId }
                : {}),
              ...(inbound.discordInteractionToken
                ? { discordInteractionToken: inbound.discordInteractionToken }
                : {}),
              idempotencyKey: `reply-${inbound.idempotencyKey}`,
            };

            await outboundQueue.add('outbound', outbound, { jobId: outbound.idempotencyKey });

            if (auditedResult) {
              await writeAuditEntry({
                db,
                log,
                inbound,
                modelId: agentModelId,
                result: auditedResult,
                classification,
              });
            }

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
