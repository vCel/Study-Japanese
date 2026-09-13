-- Private per-owner content.
--
-- Every content row is now scoped to an owner:
--   * signed-in users  -> owner_id = their Convex user id (account-scoped, cross-device)
--   * signed-out users -> owner_id = a device id cookie (device-scoped, private)
--   * NULL             -> template / starter-pack rows (seeded content)
--
-- Children (meanings, examples, rule_examples, rule_tags, rule_related,
-- word_list_tags) are reached through their parent's id, so scoping the parent
-- table is enough. `tags` stays a global name registry (names are not content);
-- tag *lookups* are filtered through the owner's lists/rules so no tag usage
-- leaks across owners.

ALTER TABLE words ADD COLUMN owner_id TEXT;
ALTER TABLE word_lists ADD COLUMN owner_id TEXT;
ALTER TABLE rules ADD COLUMN owner_id TEXT;

CREATE INDEX idx_words_owner ON words(owner_id);
CREATE INDEX idx_word_lists_owner ON word_lists(owner_id);
CREATE INDEX idx_rules_owner ON rules(owner_id);

-- Existing seeded rows become the starter pack (owner_id NULL). They are only
-- exposed when a new owner opts in via onboarding (see copyStarterPack).

-- One row per owner recording their onboarding choice (0 = started empty,
-- 1 = copied the starter pack). Lets the home page stop nagging after the
-- first visit.
CREATE TABLE owner_prefs (
  owner_id TEXT PRIMARY KEY,
  starter_chosen INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
