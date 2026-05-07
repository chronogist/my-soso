import { sql } from 'drizzle-orm';
import { schema, withServiceContext, type Database } from '@my-soso/db';
import type { BudgetSnapshot, BudgetTracker } from './budget.js';

export interface PgBudgetTrackerOptions {
  db: Database;
  provider: string;
  /** Total calls allowed per calendar month. */
  monthlyLimit: number;
  /** Fraction (0–1) at which `warnTripped` flips. Default 0.7. */
  warnThreshold?: number;
  /** Fraction (0–1) at which `hardStopTripped` flips. Default 0.95. */
  hardStopThreshold?: number;
}

/**
 * `acquire` is implemented as a single SQL statement so two replicas
 * cannot collectively overshoot the budget:
 *
 *   INSERT ... ON CONFLICT DO UPDATE
 *     SET calls_used = calls_used + $count
 *     WHERE calls_used + $count <= calls_limit
 *     RETURNING calls_used;
 *
 * If the WHERE clause filters out the update the statement returns
 * zero rows, which we read as "rejected, budget exhausted." On the
 * first call of a new month the row is inserted with `calls_used =
 * count` and `calls_limit = monthlyLimit`.
 */
export function createPgBudgetTracker(opts: PgBudgetTrackerOptions): BudgetTracker {
  const warn = opts.warnThreshold ?? 0.7;
  const hardStop = opts.hardStopThreshold ?? 0.95;

  return {
    acquire: async (count) => {
      if (count <= 0) return true;
      const rows = await withServiceContext(opts.db, async (tx) =>
        tx.execute<{ calls_used: number }>(sql`
          INSERT INTO provider_usage_budgets (provider, period_start, calls_used, calls_limit)
          VALUES (
            ${opts.provider},
            date_trunc('month', now() AT TIME ZONE 'UTC'),
            ${count},
            ${opts.monthlyLimit}
          )
          ON CONFLICT (provider, period_start) DO UPDATE
            SET calls_used = provider_usage_budgets.calls_used + ${count},
                updated_at = now()
            WHERE provider_usage_budgets.calls_used + ${count}
                  <= provider_usage_budgets.calls_limit
          RETURNING calls_used
        `),
      );
      // postgres-js + drizzle: result is iterable like an array
      const arr = Array.from(rows as unknown as { calls_used: number }[]);
      return arr.length > 0;
    },

    snapshot: async () => {
      const rows = await withServiceContext(opts.db, async (tx) =>
        tx
          .select()
          .from(schema.providerUsageBudgets)
          .where(
            sql`${schema.providerUsageBudgets.provider} = ${opts.provider}
                AND ${schema.providerUsageBudgets.periodStart} =
                  date_trunc('month', now() AT TIME ZONE 'UTC')`,
          )
          .limit(1),
      );
      const row = rows[0];
      const used = row?.callsUsed ?? 0;
      const limit = row?.callsLimit ?? opts.monthlyLimit;
      const periodStart =
        row?.periodStart ??
        new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const ratio = used / limit;
      const out: BudgetSnapshot = {
        provider: opts.provider,
        periodStart,
        callsUsed: used,
        callsLimit: limit,
        warnTripped: ratio >= warn,
        hardStopTripped: ratio >= hardStop,
      };
      return out;
    },
  };
}
