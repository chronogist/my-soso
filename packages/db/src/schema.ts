import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  privyUserId: text('privy_user_id').notNull().unique(),
  walletAddress: text('wallet_address'),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const channelLinks = pgTable(
  'channel_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['telegram', 'discord', 'whatsapp'] }).notNull(),
    channelUserId: text('channel_user_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('channel_links_channel_user_idx').on(t.channel, t.channelUserId),
    uniqueIndex('channel_links_user_channel_idx').on(t.userId, t.channel),
  ],
);

export const watchlists = pgTable(
  'watchlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('watchlists_user_name_idx').on(t.userId, t.name)],
);

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(() => watchlists.id, { onDelete: 'cascade' }),
    assetSymbol: text('asset_symbol').notNull(),
    assetKind: text('asset_kind').notNull().default('crypto'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('watchlist_items_watchlist_symbol_idx').on(t.watchlistId, t.assetSymbol),
    uniqueIndex('watchlist_items_user_symbol_idx').on(t.userId, t.assetSymbol),
  ],
);

export const providerUsageBudgets = pgTable(
  'provider_usage_budgets',
  {
    provider: text('provider').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    callsUsed: bigint('calls_used', { mode: 'number' }).notNull().default(0),
    callsLimit: bigint('calls_limit', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.periodStart] })],
);

export type ProviderUsageBudget = typeof providerUsageBudgets.$inferSelect;
export type NewProviderUsageBudget = typeof providerUsageBudgets.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChannelLink = typeof channelLinks.$inferSelect;
export type NewChannelLink = typeof channelLinks.$inferInsert;
export type Watchlist = typeof watchlists.$inferSelect;
export type NewWatchlist = typeof watchlists.$inferInsert;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type NewWatchlistItem = typeof watchlistItems.$inferInsert;

/**
 * Reference SQL for RLS bootstrap. Authoritative DDL lives in the
 * numbered migration files under `src/migrations/`. Both tables ENABLE
 * and FORCE row-level security; both policies cover USING and WITH CHECK
 * so an UPDATE cannot reassign a row to another tenant.
 *
 * The API service must `SET LOCAL app.user_id` per request; the policies
 * below then enforce per-tenant isolation.
 */
export const rlsBootstrapSql = sql`
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE users FORCE ROW LEVEL SECURITY;
	  ALTER TABLE channel_links ENABLE ROW LEVEL SECURITY;
	  ALTER TABLE channel_links FORCE ROW LEVEL SECURITY;
	  ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
	  ALTER TABLE watchlists FORCE ROW LEVEL SECURITY;
	  ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
	  ALTER TABLE watchlist_items FORCE ROW LEVEL SECURITY;

	  DROP POLICY IF EXISTS users_self ON users;
	  CREATE POLICY users_self ON users
	    USING (
	      nullif(current_setting('app.service_context', true), '') = 'true'
	      OR id = nullif(current_setting('app.user_id', true), '')::uuid
	    )
	    WITH CHECK (
	      nullif(current_setting('app.service_context', true), '') = 'true'
	      OR id = nullif(current_setting('app.user_id', true), '')::uuid
	    );

	  DROP POLICY IF EXISTS channel_links_tenant_isolation ON channel_links;
	  CREATE POLICY channel_links_tenant_isolation ON channel_links
	    USING (
	      nullif(current_setting('app.service_context', true), '') = 'true'
	      OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
	    )
	    WITH CHECK (
	      nullif(current_setting('app.service_context', true), '') = 'true'
	      OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
	    );

	  DROP POLICY IF EXISTS watchlists_tenant_isolation ON watchlists;
	  CREATE POLICY watchlists_tenant_isolation ON watchlists
	    USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
	    WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

	  DROP POLICY IF EXISTS watchlist_items_tenant_isolation ON watchlist_items;
	  CREATE POLICY watchlist_items_tenant_isolation ON watchlist_items
	    USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
	    WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
	`;
