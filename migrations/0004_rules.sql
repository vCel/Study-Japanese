-- Word/sentence rules & forms. Only admins can add or edit these.

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('word', 'sentence')),
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  pattern TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE rule_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  japanese TEXT NOT NULL,
  english TEXT NOT NULL
);

CREATE INDEX idx_rules_kind ON rules(kind);
CREATE INDEX idx_rule_examples_rule_id ON rule_examples(rule_id);

-- Sample rules
INSERT INTO rules (id, kind, title, explanation, pattern) VALUES
  (1, 'word', 'Polite ます-form', 'Attach ます to the verb stem to make the polite (non-past) form. Drop ます and add ました for the polite past.', 'Verb stem + ます'),
  (2, 'sentence', 'Topic marker は vs subject marker が', 'は marks the topic the sentence is about, while が marks the grammatical subject and adds emphasis or new information. As a rule of thumb: use は for known topics, が for new or contrasted subjects.', '[Topic] は … / [Subject] が …'),
  (3, 'word', 'Adjective conjugation (い-adjectives)', 'い-adjectives conjugate directly: drop the final い and add くない (negative), かった (past) or くなかった (negative past).', 'い-adjective stem + くない / かった');

INSERT INTO rule_examples (rule_id, japanese, english) SELECT id, '書く → 書きます', 'kaku → kakimasu (to write → writes, politely)' FROM rules WHERE id = 1;
INSERT INTO rule_examples (rule_id, japanese, english) SELECT id, '食べる → 食べました', 'taberu → tabemashita (to eat → ate, politely)' FROM rules WHERE id = 1;
INSERT INTO rule_examples (rule_id, japanese, english) SELECT id, '私は学生です。', 'I am a student. (About me: I am a student.)' FROM rules WHERE id = 2;
INSERT INTO rule_examples (rule_id, japanese, english) SELECT id, '誰が来ましたか。', 'Who came? (New information: the subject is unknown.)' FROM rules WHERE id = 2;
INSERT INTO rule_examples (rule_id, japanese, english) SELECT id, '高い → 高くない', 'takai → takunai (expensive → not expensive)' FROM rules WHERE id = 3;
INSERT INTO rule_examples (rule_id, japanese, english) SELECT id, '高い → 高かった', 'takai → takakatta (expensive → was expensive)' FROM rules WHERE id = 3;