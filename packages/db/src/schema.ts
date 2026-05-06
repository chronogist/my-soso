import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChannelLink = typeof channelLinks.$inferSelect;
export type NewChannelLink = typeof channelLinks.$inferInsert;

/**
 * Helper SQL emitted as part of bootstrap/migration runs.
 *
 * Drizzle does not yet have stable codegen for Row-Level Security policies,
 * so we ship them as raw SQL. The API service must `SET LOCAL app.user_id`
 * per request; the policies below then enforce per-tenant isolation.
 */
export const rlsBootstrapSql = sql`
  ALTER TABLE channel_links ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS channel_links_tenant_isolation ON channel_links;
  CREATE POLICY channel_links_tenant_isolation ON channel_links
    USING (user_id = current_setting('app.user_id', true)::uuid);
`;
