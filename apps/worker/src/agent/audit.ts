import { schema, withServiceContext, type Database } from '@my-soso/db';
import type { Logger } from 'pino';
import type { InboundJob } from '@my-soso/queue';
import type { RunAgentResult } from './agent.js';

/**
 * Persists every agent response to agent_audit_log for compliance
 * review. Phase 4 stamps everything `market_info`; the phase 5
 * compliance classifier upgrades the column on advice-class
 * responses.
 *
 * The unique index on (conversation_id, inbound_idempotency_key)
 * makes the writer idempotent: if a worker crash redelivers the
 * inbound job and we re-run the agent, the second insert is a
 * no-op rather than a duplicate row.
 */
export async function writeAuditEntry({
  db,
  log,
  inbound,
  modelId,
  result,
  errorMessage,
}: {
  db: Database;
  log: Logger;
  inbound: InboundJob;
  modelId: string;
  /** Set when the agent ran successfully. */
  result?: RunAgentResult;
  /** Set when the agent threw before producing a reply. */
  errorMessage?: string;
}): Promise<void> {
  // Audit must never block the user-facing reply. Wrap in try/catch
  // so a transient db error logs once and moves on.
  try {
    await withServiceContext(db, async (tx) =>
      tx
        .insert(schema.agentAuditLog)
        .values({
          userId: inbound.userId,
          conversationId: inbound.conversationId,
          inboundIdempotencyKey: inbound.idempotencyKey,
          channel: inbound.channel,
          userMessage: inbound.text,
          responseText: result?.text ?? errorMessage ?? '',
          classification: 'market_info',
          model: modelId,
          stepCount: result?.steps ?? 0,
          totalTokens: result?.totalTokens ?? null,
          finishReason: result?.finishReason ?? (errorMessage ? 'error' : null),
        })
        .onConflictDoNothing(),
    );
  } catch (err) {
    log.warn({ err, conversationId: inbound.conversationId }, 'agent audit write failed');
  }
}
