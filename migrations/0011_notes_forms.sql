-- Notes + conjugation forms.
--
-- Every content row gains an optional free-text "notes" field (words, phrases —
-- which are `words` rows — and rules). Words additionally carry a list of
-- conjugation forms (dictionary / masu / te / ta / nai / …) as a JSON array of
-- `{ name, value }` pairs in `words.forms`, in display order. The JSON column
-- mirrors the existing `rules.points` pattern (short, bounded, order-preserving).

ALTER TABLE words ADD COLUMN notes TEXT;
ALTER TABLE words ADD COLUMN forms TEXT;
ALTER TABLE rules ADD COLUMN notes TEXT;
