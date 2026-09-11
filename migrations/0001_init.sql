-- Japanese vocabulary schema for Cloudflare D1

CREATE TABLE words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  kana TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE meanings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  meaning TEXT NOT NULL
);

CREATE TABLE examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  japanese TEXT NOT NULL,
  translation TEXT
);

CREATE INDEX idx_words_word ON words(word);
CREATE INDEX idx_words_kana ON words(kana);
CREATE INDEX idx_meanings_word_id ON meanings(word_id);
CREATE INDEX idx_examples_word_id ON examples(word_id);