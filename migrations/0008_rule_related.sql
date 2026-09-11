-- Related rules are curated by an admin on the rule form, never inferred from
-- tags or wording. Stored as a join table so a rule can point at several
-- others and show up under any of them.

CREATE TABLE rule_related (
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  related_rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, related_rule_id)
);

CREATE INDEX idx_rule_related_rule_id ON rule_related(rule_id);
