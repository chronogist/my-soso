-- Wave 2: add optional holdings data to watchlist items
-- All columns nullable so existing rows are untouched; users opt in by setting them.

ALTER TABLE watchlist_items
  ADD COLUMN quantity        numeric(30, 10),
  ADD COLUMN avg_entry_price numeric(30, 10),
  ADD COLUMN entry_date      date;
