-- A rule's ポイント (point!) line is no longer limited to one: `points` stores a
-- JSON array of up to four strings, in the order they should be shown.
--
-- The original single-value `pattern` column is kept — it mirrors the first
-- point on every write — so free-text search and any older reader keep working.
-- Existing rows are left NULL here: the data layer falls back to `pattern` and
-- fills `points` in as soon as the rule is next saved.

ALTER TABLE rules ADD COLUMN points TEXT;
