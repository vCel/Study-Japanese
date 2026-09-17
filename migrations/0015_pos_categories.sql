-- "expression", "pronoun" and "interjection" are not values the app knows.
--
-- None is in POS_VALUES, so those rows were absent from every pill on /words,
-- and none is in word-edit.tsx's own whitelist either — so saving one parsed its
-- pos to null and blanked it. Each row goes to the class that fits it.

-- Greetings and set expressions. There is no class of their own, and "phrase" is
-- not one: it is the Phrases-page discriminator, and /phrases/lists picks a list
-- by "holds a phrase row" and then reports that list's TOTAL row count as its
-- phrase count — so moving one inside a mixed list would have N5 Chapter 1 (49
-- rows, 8 of them greetings) claim 49 phrases.
UPDATE words SET pos = 'other' WHERE pos IN ('expression', 'interjection');

-- どちら and 何 are pronouns — a subclass of noun, which is the class they belong
-- to. No subtype: none of common / proper / suffix describes a pronoun.
UPDATE words SET pos = 'noun' WHERE pos = 'pronoun';

-- Three rows carried subtype 'phrase' on pos 'other'. The subtype control is
-- disabled for a pos with no catalog, and a disabled <select> submits nothing,
-- so the value was already being dropped on the next save; it is wrong for all
-- three anyway — どういう is an adnominal, and the other two sit in a mixed list.
UPDATE words SET subtype = NULL WHERE pos = 'other' AND subtype = 'phrase';
