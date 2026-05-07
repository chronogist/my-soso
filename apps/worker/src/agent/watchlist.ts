import { and, eq } from 'drizzle-orm';
import { schema, withTenantUser, type Database } from '@my-soso/db';

/**
 * Ensures the user has a default watchlist row. Mirrors the helper
 * in apps/api/src/routes/v1.ts so the worker can write watchlist
 * items without depending on the dashboard having run /v1/session
 * recently.
 *
 * Race-tolerant: insert ON CONFLICT DO NOTHING, then re-select on
 * the rare path where two concurrent agent calls created at once.
 */
export async function ensureDefaultWatchlist(
  db: Database,
  userId: string,
): Promise<typeof schema.watchlists.$inferSelect> {
  const [existing] = await withTenantUser(db, userId, async (tx) =>
    tx
      .select()
      .from(schema.watchlists)
      .where(and(eq(schema.watchlists.userId, userId), eq(schema.watchlists.isDefault, true)))
      .limit(1),
  );
  if (existing) return existing;

  const [created] = await withTenantUser(db, userId, async (tx) =>
    tx
      .insert(schema.watchlists)
      .values({ userId, name: 'Default', isDefault: true })
      .onConflictDoNothing()
      .returning(),
  );
  if (created) return created;

  const [fallback] = await withTenantUser(db, userId, async (tx) =>
    tx
      .select()
      .from(schema.watchlists)
      .where(and(eq(schema.watchlists.userId, userId), eq(schema.watchlists.name, 'Default')))
      .limit(1),
  );
  if (!fallback) throw new Error('failed to ensure default watchlist');
  return fallback;
}
