-- Phase 4: per-user digest schedule preference.
--
-- Users opt in to a daily or weekly digest from the dashboard or by
-- asking the agent. The digest job in the worker runs hourly and
-- delivers to users whose schedule matches the current hour and who
-- haven't received the same period's digest yet — dedup is handled
-- by notification_deliveries via a synthetic alert_id.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS digest_schedule text NOT NULL DEFAULT 'off'
    CHECK (digest_schedule IN ('off', 'daily', 'weekly'));

-- Separate from notification_deliveries because digests have no
-- backing alert_id and we want a clean unique constraint without
-- having to special-case nulls in a partial index.
CREATE TABLE IF NOT EXISTS digest_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('telegram', 'discord', 'whatsapp')),
  schedule     text NOT NULL CHECK (schedule IN ('daily', 'weekly')),
  -- Period bucket: "2026-05-07" for daily, "2026-W19" for weekly.
  period_key   text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS digest_deliveries_dedup_idx
  ON digest_deliveries (user_id, schedule, period_key);

ALTER TABLE digest_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE digest_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS digest_deliveries_tenant_isolation ON digest_deliveries;
CREATE POLICY digest_deliveries_tenant_isolation ON digest_deliveries
  USING (
    nullif(current_setting('app.service_context', true), '') = 'true'
    OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.service_context', true), '') = 'true'
    OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );
