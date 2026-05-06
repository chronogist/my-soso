import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>;

export interface CreateDbOptions {
  url: string;
  /** Maximum pool size. Defaults to 10. */
  max?: number;
  /** Idle timeout in seconds before a pooled connection is released. Defaults to 30. */
  idleTimeout?: number;
  /** Connection timeout in seconds. Defaults to 10. */
  connectTimeout?: number;
}

export function createDb(opts: CreateDbOptions) {
  const client = postgres(opts.url, {
    max: opts.max ?? 10,
    idle_timeout: opts.idleTimeout ?? 30,
    connect_timeout: opts.connectTimeout ?? 10,
    prepare: false,
  });
  return drizzle(client, { schema });
}

/**
 * Run `fn` inside a transaction with `SET LOCAL app.user_id = <userId>`,
 * enabling Postgres Row-Level Security policies to scope reads/writes to
 * the requesting user's rows only.
 *
 * The API service should call this on every authenticated request so a
 * bug in the repo layer cannot leak data across tenants — Postgres
 * itself rejects the read.
 */
export async function withTenantUser<T>(
  db: Database,
  userId: string,
  fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.user_id = ${userId}`);
    return fn(tx);
  });
}

/** Cheap connectivity probe for liveness/readiness checks. */
export async function healthCheck(
  db: Database,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
