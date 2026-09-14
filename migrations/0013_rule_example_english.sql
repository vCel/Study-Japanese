-- A rule example now carries *two* English fields, because they answer two
-- different questions:
--
--   * `english`            — the English translation of the example sentence,
--                            i.e. what the sentence means.
--   * `english_equivalent` — the English *equivalent* of the grammar being
--                            demonstrated, i.e. how the same idea is actually
--                            said in English. This is the field the rule page
--                            uses to break the pattern down.
--
-- Worked example (causative-polite vs passive-polite):
--
--   友達に手伝ってもらいました。
--     english            = "My friend helped me."
--     english_equivalent = "I had my friend help me."
--
--   友達に手伝われました。
--     english            = "My friend helped me."
--     english_equivalent = "I was helped by my friend."
--
-- The column is nullable: existing rows keep working (their `english` is shown
-- on its own) and an example may simply not have an equivalent yet.

ALTER TABLE rule_examples ADD COLUMN english_equivalent TEXT;

-- Backfill: every example that already carries an English translation shows it
-- as its equivalent too, so the "English equivalents" section on the rule page
-- keeps rendering exactly what it did before this column existed. Owners can
-- then correct any line where the two genuinely differ.
UPDATE rule_examples
   SET english_equivalent = english
 WHERE english_equivalent IS NULL
   AND english IS NOT NULL
   AND TRIM(english) <> '';
