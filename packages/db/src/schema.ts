import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
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
  digestSchedule: text('digest_schedule', { enum: ['off', 'daily', 'weekly'] })
    .notNull()
    .default('off'),
  preferences: jsonb('preferences').notNull().default({}),
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

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['price', 'news', 'etf_flow', 'index_move', 'sentiment', 'macro'],
    }).notNull(),
    assetSymbol: text('asset_symbol').notNull(),
    assetKind: text('asset_kind').notNull().default('crypto'),
    priceOp: text('price_op', { enum: ['lt', 'lte', 'gt', 'gte'] }),
    priceThreshold: numeric('price_threshold'),
    params: jsonb('params').notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  },
  (t) => [index('alerts_user_idx').on(t.userId), index('alerts_symbol_idx').on(t.assetSymbol)],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => alerts.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['telegram', 'discord', 'whatsapp'] }).notNull(),
    dedupKey: text('dedup_key').notNull(),
    payload: jsonb('payload').notNull().default({}),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_deliveries_dedup_idx').on(t.userId, t.alertId, t.dedupKey),
    index('notification_deliveries_user_time_idx').on(t.userId, t.deliveredAt),
  ],
);

export const newsExtractions = pgTable(
  'news_extractions',
  {
    articleId: text('article_id').primaryKey(),
    source: text('source').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    affectedAssets: text('affected_assets')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sentiment: text('sentiment', { enum: ['bullish', 'bearish', 'neutral'] }).notNull(),
    severity: text('severity', { enum: ['low', 'medium', 'high'] }).notNull(),
    summary: text('summary').notNull(),
    model: text('model').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('news_extractions_published_idx').on(t.publishedAt)],
);

export const agentAuditLog = pgTable(
  'agent_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    conversationId: text('conversation_id').notNull(),
    inboundIdempotencyKey: text('inbound_idempotency_key').notNull(),
    channel: text('channel').notNull(),
    userMessage: text('user_message').notNull(),
    responseText: text('response_text').notNull(),
    classification: text('classification', {
      enum: ['market_info', 'education', 'personalized_analysis', 'recommendation', 'execution'],
    })
      .notNull()
      .default('market_info'),
    model: text('model').notNull(),
    stepCount: integer('step_count').notNull().default(0),
    totalTokens: integer('total_tokens'),
    finishReason: text('finish_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_audit_log_user_time_idx').on(t.userId, t.createdAt),
    index('agent_audit_log_classification_idx').on(t.classification, t.createdAt),
    uniqueIndex('agent_audit_log_inbound_idx').on(t.conversationId, t.inboundIdempotencyKey),
  ],
);

export const digestDeliveries = pgTable(
  'digest_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['telegram', 'discord', 'whatsapp'] }).notNull(),
    schedule: text('schedule', { enum: ['daily', 'weekly'] }).notNull(),
    periodKey: text('period_key').notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('digest_deliveries_dedup_idx').on(t.userId, t.schedule, t.periodKey)],
);
export type DigestDelivery = typeof digestDeliveries.$inferSelect;
export type NewDigestDelivery = typeof digestDeliveries.$inferInsert;

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;
export type NewsExtraction = typeof newsExtractions.$inferSelect;
export type NewNewsExtraction = typeof newsExtractions.$inferInsert;
export type AgentAuditLogRow = typeof agentAuditLog.$inferSelect;
export type NewAgentAuditLogRow = typeof agentAuditLog.$inferInsert;

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
