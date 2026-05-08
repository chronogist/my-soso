-- Phase 5: bot-behavior preferences + expanded alert kinds.
--
-- All hub-driven behavior knobs live in users.preferences (jsonb).
-- One column avoids a column-explosion migration every time the hub
-- ships a new toggle. Worker-side enforcement is wired per knob as
-- features land — until then, presence in this column is the single
-- source of truth read by both API and worker.
--
-- alerts.params (jsonb) carries kind-specific config for the new
-- alert kinds (etf_flow, index_move, sentiment, macro). The CHECK
-- on (kind, price_op, price_threshold) is loosened so non-price
-- kinds simply leave those columns null.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Drop the old kind check (price/news only) and the old composite
-- check that forced price-only/news-only column shapes.
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_kind_check;
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_check;

ALTER TABLE alerts
  ADD CONSTRAINT alerts_kind_check
  CHECK (kind IN ('price', 'news', 'etf_flow', 'index_move', 'sentiment', 'macro'));

ALTER TABLE alerts
  ADD CONSTRAINT alerts_price_shape_check
  CHECK (
    (kind = 'price'  AND price_op IS NOT NULL AND price_threshold IS NOT NULL)
    OR (kind <> 'price' AND price_op IS NULL  AND price_threshold IS NULL)
  );
