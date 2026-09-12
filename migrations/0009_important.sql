-- "Important" / priority stars.
--
-- A star is a single flag on the row itself (words and rules), not a per-user
-- preference: the app has one shared collection, so starring marks a card as
-- priority for whoever studies it next. Words cover phrases too (a phrase is a
-- `words` row with `pos = 'phrase'`).
--
-- The flag is only *set* from a word list card (words/phrases) and from the
-- rules list, and it is what the study screens filter on with
-- `important = 1` ("starred only").

ALTER TABLE words ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rules ADD COLUMN important INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_words_important ON words(important);
CREATE INDEX idx_rules_important ON rules(important);
