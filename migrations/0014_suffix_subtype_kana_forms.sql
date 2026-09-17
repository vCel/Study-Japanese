-- "suffix" becomes a noun subtype, and romaji form names become kana.
--
-- `suffix` was being stored as a part of speech, but POS_VALUES has no "suffix",
-- so the rows holding it (～さん, ～人 — template rows and their copies) were
-- absent from the Nouns filter on /words, and the word-edit form's pos select had
-- no option to match, so saving one blanked its pos.
UPDATE words
SET pos = 'noun',
    subtype = COALESCE(subtype, 'suffix')
WHERE pos = 'suffix';

-- Form names in romaji become kana. The mapping itself lives in
-- app/lib/form-names.ts and runs on every import, read and write, so this only
-- has to clean the spellings the table actually held when it was written —
-- te ×17, ta ×17, nai ×17, te-form ×13; ます was already kana. Written
-- tolerantly — case, spaces, hyphens and underscores are stripped — so "Te",
-- "te form" and "te_form" land where "te-form" does.
UPDATE words
SET forms = (
  SELECT json_group_array(
           json_object(
             'name',
             COALESCE(
               CASE lower(
                 replace(replace(replace(trim(json_extract(j.value, '$.name')), ' ', ''), '-', ''), '_', '')
               )
                 WHEN 'te' THEN 'て'
                 WHEN 'ta' THEN 'た'
                 WHEN 'nai' THEN 'ない'
                 WHEN 'teform' THEN 'て形'
                 ELSE json_extract(j.value, '$.name')
               END,
               ''
             ),
             'value', COALESCE(json_extract(j.value, '$.value'), '')
           )
         )
  FROM json_each(words.forms) AS j
)
WHERE forms IS NOT NULL
  AND json_valid(forms) = 1;
