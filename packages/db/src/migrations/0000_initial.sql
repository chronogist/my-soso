-- Initial schema: users + channel_links + RLS policies.
-- Apply with `pnpm --filter @my-soso/db db:migrate` once DATABASE_URL is set.

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  privy_user_id   text NOT NULL UNIQUE,
  wallet_address  text,
  plan            text NOT NULL DEFAULT 'free',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('telegram', 'discord', 'whatsapp')),
  channel_user_id  text NOT NULL,
  linked_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS channel_links_channel_user_idx
  ON channel_links (channel, channel_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS channel_links_user_channel_idx
  ON channel_links (user_id, channel);

-- ─── Row-Level Security ───────────────────────────────────────────────────
-- The API service must `SET LOCAL app.user_id = '<uuid>'` per request.
-- Policies below then enforce per-tenant isolation.

ALTER TABLE channel_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_links_tenant_isolation ON channel_links;
CREATE POLICY channel_links_tenant_isolation ON channel_links
  USING (user_id = current_setting('app.user_id', true)::uuid);
