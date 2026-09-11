-- Tags for rules & forms, mirroring the word-list tagging system.

CREATE TABLE rule_tags (
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, tag_id)
);

CREATE INDEX idx_rule_tags_tag_id ON rule_tags(tag_id);

-- Tag the seeded rules (rule 3 gets three tags so the "+x" overflow shows up).
INSERT OR IGNORE INTO tags (name) VALUES ('verbs'), ('particles'), ('adjectives');

INSERT INTO rule_tags (rule_id, tag_id) SELECT 1, id FROM tags WHERE name = 'verbs';
INSERT INTO rule_tags (rule_id, tag_id) SELECT 1, id FROM tags WHERE name = 'jlpt';
INSERT INTO rule_tags (rule_id, tag_id) SELECT 2, id FROM tags WHERE name = 'particles';
INSERT INTO rule_tags (rule_id, tag_id) SELECT 2, id FROM tags WHERE name = 'jlpt';
INSERT INTO rule_tags (rule_id, tag_id) SELECT 3, id FROM tags WHERE name = 'adjectives';
INSERT INTO rule_tags (rule_id, tag_id) SELECT 3, id FROM tags WHERE name = 'jlpt';
INSERT INTO rule_tags (rule_id, tag_id) SELECT 3, id FROM tags WHERE name = 'n5';
