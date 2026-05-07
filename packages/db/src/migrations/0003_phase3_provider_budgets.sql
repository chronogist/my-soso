-- Phase 3: monthly upstream-provider usage budget.
--
-- Tracks calls consumed against an external API quota. The provider
-- composer increments `calls_used` after every successful upstream
-- call; the prefetcher and on-demand path both check `calls_used`
-- against `calls_limit` before issuing a new call.
--
-- Primary key is (provider, period_start) so each calendar month
-- gets its own row. period_start is the first instant of the UTC
-- month so DATE_TRUNC('month', now() at time zone 'UTC') matches.

CREATE TABLE IF NOT EXISTS provider_usage_budgets (
  provider      text         NOT NULL,
  period_start  timestamptz  NOT NULL,
  calls_used    bigint       NOT NULL DEFAULT 0,
  calls_limit   bigint       NOT NULL,
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, period_start),
  CHECK (calls_used >= 0),
  CHECK (calls_limit > 0)
);

-- Service-context only: this table is global, not user-scoped, but we
-- keep RLS enabled so a tenant connection cannot read or write the
-- counter even if the app forgets to use the service context.
ALTER TABLE provider_usage_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_usage_budgets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_usage_budgets_service_only ON provider_usage_budgets;
CREATE POLICY provider_usage_budgets_service_only ON provider_usage_budgets
  USING (nullif(current_setting('app.service_context', true), '') = 'true')
  WITH CHECK (nullif(current_setting('app.service_context', true), '') = 'true');
