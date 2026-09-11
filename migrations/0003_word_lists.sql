-- Word lists + tags. Every JSON import creates one word list.

CREATE TABLE word_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE word_list_tags (
  list_id INTEGER NOT NULL REFERENCES word_lists(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, tag_id)
);

ALTER TABLE words ADD COLUMN list_id INTEGER REFERENCES word_lists(id) ON DELETE SET NULL;

CREATE INDEX idx_words_list_id ON words(list_id);
CREATE INDEX idx_word_list_tags_tag_id ON word_list_tags(tag_id);
CREATE INDEX idx_word_list_tags_list_id ON word_list_tags(list_id);

-- Sample lists so the seeded vocabulary is organised out of the box.
INSERT INTO word_lists (id, title, description) VALUES
  (1, 'JLPT N5 Starter', 'Core vocabulary for the JLPT N5 exam.'),
  (2, 'Daily Conversation', 'Everyday words for casual conversation.');

INSERT INTO tags (name) VALUES ('jlpt'), ('n5'), ('daily'), ('conversation');

INSERT INTO word_list_tags (list_id, tag_id) VALUES
  (1, 1), (1, 2),
  (2, 3), (2, 4);

UPDATE words SET list_id = 1 WHERE word IN ('日本語', '勉強', '学校', '先生', '今日', '水');
UPDATE words SET list_id = 2 WHERE word IN ('友達', '食べる', '飲む', '行く', '来る', '見る', '聞く', '話す', '猫', '犬');