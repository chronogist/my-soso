-- Phase 4: alerts, notification deliveries, news extractions, audit log.
--
-- Tenant tables (alerts, notification_deliveries) follow the existing
-- per-user RLS pattern from phase 2. Cross-tenant tables (news_extractions
-- because the LLM output is shared across all users tagged to an article,
-- and agent_audit_log because operators must read the full corpus during
-- compliance review) are policy-locked to service-context only — even an
-- accidental tenant connection cannot reach them.

-- ─── alerts ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  -- Wave 1 ships two alert kinds. The check constraint stays loose so we
  -- can grow into volume / etf-flow alerts in phase 4.5 without a migration
  -- reshape, only an additive migration to the constraint.
  kind            text NOT NULL CHECK (kind IN ('price', 'news')),
  asset_symbol    text NOT NULL,
  asset_kind      text NOT NULL DEFAULT 'crypto',
  -- Price alerts only.
  price_op        text CHECK (price_op IS NULL OR price_op IN ('lt', 'lte', 'gt', 'gte')),
  price_threshold numeric,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_fired_at   timestamptz,
  -- Price-kind rows must carry both op and threshold; news-kind rows must not.
  CHECK (
    (kind = 'price' AND price_op IS NOT NULL AND price_threshold IS NOT NULL)
    OR (kind = 'news' AND price_op IS NULL AND price_threshold IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS alerts_user_idx        ON alerts (user_id);
CREATE INDEX IF NOT EXISTS alerts_active_kind_idx ON alerts (active, kind) WHERE active;
CREATE INDEX IF NOT EXISTS alerts_symbol_idx      ON alerts (asset_symbol);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alerts_tenant_isolation ON alerts;
CREATE POLICY alerts_tenant_isolation ON alerts
  USING (
    nullif(current_setting('app.service_context', true), '') = 'true'
    OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.service_context', true), '') = 'true'
    OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

-- ─── notification_deliveries ─────────────────────────────────────────────────
-- One row per (user, alert, dedup_key). The alert engine constructs
-- dedup_key so a price-cross at 14:55 only fires once across replicas
-- and across retry cycles. INSERTs use ON CONFLICT DO NOTHING; the
-- engine reads the affected row count to decide whether to enqueue
-- the outbound reply.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id     uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('telegram', 'discord', 'whatsapp')),
  dedup_key    text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_dedup_idx
  ON notification_deliveries (user_id, alert_id, dedup_key);
CREATE INDEX IF NOT EXISTS notification_deliveries_user_time_idx
  ON notification_deliveries (user_id, delivered_at DESC);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_deliveries_tenant_isolation ON notification_deliveries;
CREATE POLICY notification_deliveries_tenant_isolation ON notification_deliveries
  USING (
    nullif(current_setting('app.service_context', true), '') = 'true'
    OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.service_context', true), '') = 'true'
    OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

-- ─── news_extractions ────────────────────────────────────────────────────────
-- One LLM extraction per news article, shared across all users. Keyed
-- on the upstream article id so a re-fetch is a NOOP. This is the
-- cost-discipline contract: alert evaluation is a SQL filter against
-- `affected_assets` and `severity`, never a per-user LLM call.
CREATE TABLE IF NOT EXISTS news_extractions (
  article_id        text PRIMARY KEY,
  source            text NOT NULL,
  title             text NOT NULL,
  url               text,
  affected_assets   text[] NOT NULL DEFAULT '{}',
  sentiment         text NOT NULL CHECK (sentiment IN ('bullish', 'bearish', 'neutral')),
  severity          text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  summary           text NOT NULL,
  model             text NOT NULL,
  published_at      timestamptz NOT NULL,
  extracted_at      timestamptz NOT NULL DEFAULT now()
);

-- Pull-by-asset is the alert-engine hot path.
CREATE INDEX IF NOT EXISTS news_extractions_assets_gin_idx
  ON news_extractions USING gin (affected_assets);
CREATE INDEX IF NOT EXISTS news_extractions_published_idx
  ON news_extractions (published_at DESC);

ALTER TABLE news_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_extractions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS news_extractions_service_only ON news_extractions;
CREATE POLICY news_extractions_service_only ON news_extractions
  USING (nullif(current_setting('app.service_context', true), '') = 'true')
  WITH CHECK (nullif(current_setting('app.service_context', true), '') = 'true');

-- ─── agent_audit_log ─────────────────────────────────────────────────────────
-- Every agent response. Phase 4 stamps everything `market_info`; the
-- phase 5 compliance classifier upgrades the column on advice-class
-- responses. Operators read this for compliance review, never end users.
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid REFERENCES users(id) ON DELETE SET NULL,
  conversation_id          text NOT NULL,
  inbound_idempotency_key  text NOT NULL,
  channel                  text NOT NULL,
  user_message             text NOT NULL,
  response_text            text NOT NULL,
  classification           text NOT NULL DEFAULT 'market_info'
    CHECK (classification IN ('market_info', 'education', 'personalized_analysis', 'recommendation', 'execution')),
  model                    text NOT NULL,
  step_count               integer NOT NULL DEFAULT 0,
  total_tokens             integer,
  finish_reason            text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_audit_log_user_time_idx
  ON agent_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_audit_log_classification_idx
  ON agent_audit_log (classification, created_at DESC);
-- Idempotency: if the same inbound message is reprocessed (worker
-- crash + redelivery) we keep one row per (user, key), not duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS agent_audit_log_inbound_idx
  ON agent_audit_log (conversation_id, inbound_idempotency_key);

ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_audit_log_service_only ON agent_audit_log;
CREATE POLICY agent_audit_log_service_only ON agent_audit_log
  USING (nullif(current_setting('app.service_context', true), '') = 'true')
  WITH CHECK (nullif(current_setting('app.service_context', true), '') = 'true');
