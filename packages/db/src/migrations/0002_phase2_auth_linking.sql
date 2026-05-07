-- Phase 2 schema: service-context RLS paths + watchlist tables.

-- The API and Edge occasionally need a tiny cross-tenant operation after
-- external authentication succeeds: user upsert by Privy DID, link-code
-- redemption, and inbound channel-user resolution. These policies keep normal
-- tenant-scoped requests on `app.user_id` while allowing explicit internal
-- transactions that set `app.service_context = 'true'`.

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

CREATE TABLE IF NOT EXISTS watchlists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS watchlists_user_name_idx
  ON watchlists (user_id, name);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  watchlist_id    uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  asset_symbol    text NOT NULL,
  asset_kind      text NOT NULL DEFAULT 'crypto',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS watchlist_items_watchlist_symbol_idx
  ON watchlist_items (watchlist_id, asset_symbol);

CREATE UNIQUE INDEX IF NOT EXISTS watchlist_items_user_symbol_idx
  ON watchlist_items (user_id, asset_symbol);

ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watchlists_tenant_isolation ON watchlists;
CREATE POLICY watchlists_tenant_isolation ON watchlists
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watchlist_items_tenant_isolation ON watchlist_items;
CREATE POLICY watchlist_items_tenant_isolation ON watchlist_items
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
