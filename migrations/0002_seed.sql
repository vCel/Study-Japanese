-- Seed data: 16 starter words
INSERT INTO words (word, kana) VALUES
  ('日本語', 'にほんご'),
  ('勉強', 'べんきょう'),
  ('友達', 'ともだち'),
  ('学校', 'がっこう'),
  ('先生', 'せんせい'),
  ('食べる', 'たべる'),
  ('飲む', 'のむ'),
  ('行く', 'いく'),
  ('来る', 'くる'),
  ('見る', 'みる'),
  ('聞く', 'きく'),
  ('話す', 'はなす'),
  ('猫', 'ねこ'),
  ('犬', 'いぬ'),
  ('水', 'みず'),
  ('今日', 'きょう');

INSERT INTO meanings (word_id, meaning) SELECT id, 'Japanese language' FROM words WHERE word = '日本語';
INSERT INTO meanings (word_id, meaning) SELECT id, 'study; diligence' FROM words WHERE word = '勉強';
INSERT INTO meanings (word_id, meaning) SELECT id, 'friend; companion' FROM words WHERE word = '友達';
INSERT INTO meanings (word_id, meaning) SELECT id, 'school' FROM words WHERE word = '学校';
INSERT INTO meanings (word_id, meaning) SELECT id, 'teacher; master' FROM words WHERE word = '先生';
INSERT INTO meanings (word_id, meaning) SELECT id, 'to eat' FROM words WHERE word = '食べる';
INSERT INTO meanings (word_id, meaning) SELECT id, 'to drink; to swallow' FROM words WHERE word = '飲む';
INSERT INTO meanings (word_id, meaning) SELECT id, 'to go; to proceed' FROM words WHERE word = '行く';
INSERT INTO meanings (word_id, meaning) SELECT id, 'to come; to arrive' FROM words WHERE word = '来る';
INSERT INTO meanings (word_id, meaning) SELECT id, 'to see; to watch; to look at' FROM words WHERE word = '見る';
INSERT INTO meanings (word_id, meaning) SELECT id, 'to hear; to listen; to ask' FROM words WHERE word = '聞く';
INSERT INTO meanings (word_id, meaning) SELECT id, 'to speak; to talk; to converse' FROM words WHERE word = '話す';
INSERT INTO meanings (word_id, meaning) SELECT id, 'cat' FROM words WHERE word = '猫';
INSERT INTO meanings (word_id, meaning) SELECT id, 'dog' FROM words WHERE word = '犬';
INSERT INTO meanings (word_id, meaning) SELECT id, 'water (especially cool/fresh water)' FROM words WHERE word = '水';
INSERT INTO meanings (word_id, meaning) SELECT id, 'today; this day' FROM words WHERE word = '今日';

INSERT INTO examples (word_id, japanese, translation) SELECT id, '私は日本語を勉強しています。', 'I am studying Japanese.' FROM words WHERE word = '日本語';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '毎日二時間勉強します。', 'I study two hours every day.' FROM words WHERE word = '勉強';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '友達と映画を見ました。', 'I watched a movie with my friend.' FROM words WHERE word = '友達';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '学校は八時に始まります。', 'School starts at eight o''clock.' FROM words WHERE word = '学校';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '山田先生はとても優しいです。', 'Mr. Yamada is very kind.' FROM words WHERE word = '先生';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '朝ごはんを食べたいです。', 'I want to eat breakfast.' FROM words WHERE word = '食べる';
INSERT INTO examples (word_id, japanese, translation) SELECT id, 'コーヒーを飲みませんか。', 'Won''t you have some coffee?' FROM words WHERE word = '飲む';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '明日、東京に行きます。', 'I will go to Tokyo tomorrow.' FROM words WHERE word = '行く';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '友達が家に来ました。', 'A friend came to my house.' FROM words WHERE word = '来る';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '昨夜、新しい映画を見ました。', 'I watched a new movie last night.' FROM words WHERE word = '見る';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '音楽を聞きながら勉強します。', 'I study while listening to music.' FROM words WHERE word = '聞く';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '彼は三か国語を話せます。', 'He can speak three languages.' FROM words WHERE word = '話す';
INSERT INTO examples (word_id, japanese, translation) SELECT id, 'この猫はとても可愛いです。', 'This cat is very cute.' FROM words WHERE word = '猫';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '公園で犬を散歩させます。', 'I walk my dog in the park.' FROM words WHERE word = '犬';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '水を一杯ください。', 'Please give me a glass of water.' FROM words WHERE word = '水';
INSERT INTO examples (word_id, japanese, translation) SELECT id, '今日はとても暑いですね。', 'It''s very hot today, isn''t it?' FROM words WHERE word = '今日';