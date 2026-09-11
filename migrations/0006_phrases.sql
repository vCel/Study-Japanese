-- Phrases: a part-of-speech for studying whole phrases with their meaning.

UPDATE words SET pos = 'phrase' WHERE pos IS NULL AND word IN (
  'おはようございます', 'ありがとうございます', 'お願いします',
  'いただきます', 'ごちそうさまでした', 'お疲れ様でした'
);

INSERT INTO word_lists (id, title, description) VALUES
  (3, 'Everyday Phrases', 'Polite set phrases you will use every single day.');

INSERT INTO tags (name) VALUES ('phrases');
INSERT INTO word_list_tags (list_id, tag_id) VALUES (3, 5);

INSERT INTO words (word, kana, pos, list_id) VALUES
  ('おはようございます', 'おはようございます', 'phrase', 3),
  ('ありがとうございます', 'ありがとうございます', 'phrase', 3),
  ('お願いします', 'おねがいします', 'phrase', 3),
  ('いただきます', 'いただきます', 'phrase', 3),
  ('お疲れ様でした', 'おつかれさまでした', 'phrase', 3);

INSERT INTO meanings (word_id, meaning) SELECT id, 'Good morning (polite)' FROM words WHERE word = 'おはようございます';
INSERT INTO meanings (word_id, meaning) SELECT id, 'Thank you very much (polite)' FROM words WHERE word = 'ありがとうございます';
INSERT INTO meanings (word_id, meaning) SELECT id, 'Please / I beg of you' FROM words WHERE word = 'お願いします';
INSERT INTO meanings (word_id, meaning) SELECT id, 'Said before eating; I humbly receive' FROM words WHERE word = 'いただきます';
INSERT INTO meanings (word_id, meaning) SELECT id, 'Thank you for your hard work (to colleagues)' FROM words WHERE word = 'お疲れ様でした';

INSERT INTO examples (word_id, japanese, translation) SELECT id, 'おはようございます、田中さん。', 'Good morning, Mr. Tanaka.' FROM words WHERE word = 'おはようございます';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '本当にありがとうございます。', 'Thank you so much, really.' FROM words WHERE word = 'ありがとうございます';
INSERT INTO examples (word_id, japanese, translation) SELECT id, 'コーヒーをお願いします。', 'A coffee, please.' FROM words WHERE word = 'お願いします';
INSERT INTO examples (word_id, japanese, translation) SELECT id, 'いただきます！', 'Let''s eat! (before a meal)' FROM words WHERE word = 'いただきます';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '今日もお疲れ様でした。', 'Thank you for your hard work today as well.' FROM words WHERE word = 'お疲れ様でした';