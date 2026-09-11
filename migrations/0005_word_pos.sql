-- Part of speech for words (noun / verb / adjective / adverb / other).

ALTER TABLE words ADD COLUMN pos TEXT;

UPDATE words SET pos = 'verb' WHERE word IN ('食べる', '飲む', '行く', '来る', '見る', '聞く', '話す');
UPDATE words SET pos = 'noun' WHERE word IN ('日本語', '勉強', '友達', '学校', '先生', '猫', '犬', '水', '今日');