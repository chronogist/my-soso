-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ RLS hardening                                                            │
-- │                                                                          │
-- │ The initial migration enabled RLS on `channel_links` only and used a     │
-- │ USING-only policy. Two problems:                                         │
-- │                                                                          │
-- │   1. `users` had no RLS at all. Cross-tenant reads/writes depended on    │
-- │      perfect repository code.                                            │
-- │   2. The app connects as the table owner, which bypasses RLS unless we   │
-- │      `FORCE ROW LEVEL SECURITY`. Existing policies were decorative.      │
-- │   3. USING without WITH CHECK lets an UPDATE flip `user_id` to another   │
-- │      tenant's id, which would then pass the read policy on the new row.  │
-- │                                                                          │
-- │ This migration fixes all three.                                          │
-- └──────────────────────────────────────────────────────────────────────────┘

-- gen_random_uuid() lives in pgcrypto on Postgres. The explicit
-- CREATE EXTENSION is idempotent and safe on Supabase.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── users ────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users
  USING (id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.user_id', true), '')::uuid);

-- ─── channel_links ────────────────────────────────────────────────────────
ALTER TABLE channel_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_links_tenant_isolation ON channel_links;
CREATE POLICY channel_links_tenant_isolation ON channel_links
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- Note on signup: creating a `users` row requires `app.user_id` to be set
-- to the prospective user id *before* INSERT (so the WITH CHECK passes).
-- The auth flow generates the UUID server-side from the Privy JWT, sets
-- `SET LOCAL app.user_id`, then upserts. Implementation lands in Phase 2.
