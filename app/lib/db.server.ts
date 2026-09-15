import { env } from "cloudflare:workers";

import type { VocabEntry } from "./vocab";

/** Row shape for the `words` table. */
export interface WordRow {
  id: number;
  word: string;
  kana: string;
  created_by: string | null;
  created_at: number;
  pos: string | null;
  /** Refines pos (verb → "group1", adjective → "i-adjective", …). */
  subtype: string | null;
}

/**
 * One conjugation form of a word, e.g. dictionary / ます / て / た / ない.
 * Stored as a JSON array in `words.forms`, in display order.
 */
export interface WordForm {
  /** The form name, e.g. "ます" / "te-form" / "negative". */
  name: string;
  /** The form itself, e.g. "食べます". */
  value: string;
}

/** Word as exposed to the UI. */
export interface WordSummary {
  id: number;
  word: string;
  kana: string;
  pos: string | null;
  subtype: string | null;
  meaning: string | null;
  createdAt: number;
  listId: number | null;
  listTitle: string | null;
}

/** Word list as exposed to the UI (index view). */
export interface WordListSummary {
  id: number;
  title: string;
  description: string | null;
  createdAt: number;
  createdBy: string | null;
  wordCount: number;
  tags: string[];
}

export interface WordListDetail extends WordListSummary {
  words: WordSummary[];
}

export interface WordDetail extends WordSummary {
  meanings: string[];
  examples: { id: number; japanese: string; translation: string | null }[];
  createdBy: string | null;
  /** Convex user id of the author of the list this word belongs to (if any). */
  listAuthor: string | null;
  /** Free-text notes about this word (null = none). */
  notes: string | null;
  /** Conjugation forms, in display order (empty = none). */
  forms: WordForm[];
}

/**
 * An explicit set of card ids to draw from — the signed-in user's starred ids
 * (see `convex/stars.ts`). `null`/`undefined` means "no id filter"; an empty
 * array means "filter to nothing" (the user has starred no cards).
 */
export type CardIdFilter = number[] | null | undefined;

export interface ExampleItem {
  id: number;
  japanese: string;
  translation: string | null;
  wordId: number;
  word: string;
  kana: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface Stats {
  words: number;
  examples: number;
  lists: number;
}

const PAGE_SIZE = 24;

/** A word can carry at most this many conjugation forms. */
const MAX_WORD_FORMS = 12;

function getDb(): D1Database {
  return env.DB;
}

export async function getStats(ownerId: string): Promise<Stats> {
  const db = getDb();
  const [words, examples, lists] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS n FROM words WHERE owner_id = ?1")
      .bind(ownerId)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM examples e
         JOIN words w ON w.id = e.word_id
         WHERE w.owner_id = ?1`
      )
      .bind(ownerId)
      .first<{ n: number }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM word_lists WHERE owner_id = ?1")
      .bind(ownerId)
      .first<{ n: number }>(),
  ]);
  return {
    words: words?.n ?? 0,
    examples: examples?.n ?? 0,
    lists: lists?.n ?? 0,
  };
}

/**
 * Whether the owner has any content at all (words, lists or rules). Used by
 * onboarding to decide whether to offer the starter pack.
 */
export async function hasContent(ownerId: string): Promise<boolean> {
  const db = getDb();
  const [words, lists, rules] = await Promise.all([
    db
      .prepare("SELECT 1 FROM words WHERE owner_id = ?1 LIMIT 1")
      .bind(ownerId)
      .first(),
    db
      .prepare("SELECT 1 FROM word_lists WHERE owner_id = ?1 LIMIT 1")
      .bind(ownerId)
      .first(),
    db
      .prepare("SELECT 1 FROM rules WHERE owner_id = ?1 LIMIT 1")
      .bind(ownerId)
      .first(),
  ]);
  return Boolean(words || lists || rules);
}

/** The owner's onboarding choice (null = not chosen yet). */
export async function getStarterChoice(ownerId: string): Promise<boolean | null> {
  const db = getDb();
  const row = await db
    .prepare("SELECT starter_chosen FROM owner_prefs WHERE owner_id = ?1")
    .bind(ownerId)
    .first<{ starter_chosen: number }>();
  if (!row) return null;
  return row.starter_chosen === 1;
}

/** Record the owner's onboarding choice so the prompt never returns. */
export async function setStarterChoice(ownerId: string, choseStarter: boolean): Promise<void> {
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO owner_prefs (owner_id, starter_chosen, updated_at)
       VALUES (?1, ?2, unixepoch())
       ON CONFLICT(owner_id) DO UPDATE SET starter_chosen = ?2, updated_at = unixepoch()`
    )
    .bind(ownerId, choseStarter ? 1 : 0)
    .run();
}

/**
 * Copy the template (owner_id NULL) rows — the seeded starter pack — into the
 * given owner's namespace. New ids are minted for the copied rows; children
 * (meanings, examples, tags, related rules) follow their parent.
 */
export async function copyStarterPack(ownerId: string): Promise<{
  lists: number;
  words: number;
  rules: number;
}> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // 1. Copy word lists, keeping a map old id -> new id.
  const templateLists = await db
    .prepare("SELECT id, title, description, created_at FROM word_lists WHERE owner_id IS NULL")
    .all<{ id: number; title: string; description: string | null; created_at: number }>();
  const listIdMap = new Map<number, number>();
  const listStatements: D1PreparedStatement[] = [];
  for (const list of templateLists.results ?? []) {
    listStatements.push(
      db
        .prepare(
          "INSERT INTO word_lists (title, description, created_by, created_at, owner_id) VALUES (?1, ?2, ?3, ?4, ?5)"
        )
        .bind(list.title, list.description, ownerId, list.created_at || now, ownerId)
    );
  }
  if (listStatements.length > 0) {
    const inserted = await db.batch(listStatements);
    templateLists.results?.forEach((list, index) => {
      listIdMap.set(list.id, inserted[index]?.meta.last_row_id ?? 0);
    });
  }

  // 2. Copy words (owner NULL), then their meanings and examples.
  const templateWords = await db
    .prepare(
      "SELECT id, word, kana, created_at, pos, subtype, list_id, important, notes, forms FROM words WHERE owner_id IS NULL"
    )
    .all<{
      id: number;
      word: string;
      kana: string;
      created_at: number;
      pos: string | null;
      subtype: string | null;
      list_id: number | null;
      important: number;
      notes: string | null;
      forms: string | null;
    }>();
  const wordIdMap = new Map<number, number>();
  const wordStatements: D1PreparedStatement[] = [];
  for (const word of templateWords.results ?? []) {
    const newListId = word.list_id === null ? null : (listIdMap.get(word.list_id) ?? null);
    wordStatements.push(
      db
        .prepare(
          "INSERT INTO words (word, kana, created_by, created_at, pos, subtype, list_id, important, notes, forms, owner_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
        )
        .bind(
          word.word,
          word.kana,
          ownerId,
          word.created_at || now,
          word.pos,
          word.subtype ?? null,
          newListId,
          word.important ?? 0,
          word.notes ?? null,
          word.forms ?? null,
          ownerId
        )
    );
  }
  if (wordStatements.length > 0) {
    const inserted = await db.batch(wordStatements);
    templateWords.results?.forEach((word, index) => {
      wordIdMap.set(word.id, inserted[index]?.meta.last_row_id ?? 0);
    });
  }

  // 3. Copy meanings + examples for the copied words.
  const childStatements: D1PreparedStatement[] = [];
  for (const [oldWordId, newWordId] of wordIdMap) {
    if (!newWordId) continue;
    const meanings = await db
      .prepare("SELECT meaning FROM meanings WHERE word_id = ?1")
      .bind(oldWordId)
      .all<{ meaning: string }>();
    for (const row of meanings.results ?? []) {
      childStatements.push(
        db
          .prepare("INSERT INTO meanings (word_id, meaning) VALUES (?1, ?2)")
          .bind(newWordId, row.meaning)
      );
    }
    const examples = await db
      .prepare("SELECT japanese, translation FROM examples WHERE word_id = ?1")
      .bind(oldWordId)
      .all<{ japanese: string; translation: string | null }>();
    for (const row of examples.results ?? []) {
      childStatements.push(
        db
          .prepare("INSERT INTO examples (word_id, japanese, translation) VALUES (?1, ?2, ?3)")
          .bind(newWordId, row.japanese, row.translation)
      );
    }
  }

  // 4. Copy word-list tags (tags names are global; links point to the new list).
  for (const [oldListId, newListId] of listIdMap) {
    if (!newListId) continue;
    const links = await db
      .prepare("SELECT tag_id FROM word_list_tags WHERE list_id = ?1")
      .bind(oldListId)
      .all<{ tag_id: number }>();
    for (const row of links.results ?? []) {
      childStatements.push(
        db
          .prepare("INSERT OR IGNORE INTO word_list_tags (list_id, tag_id) VALUES (?1, ?2)")
          .bind(newListId, row.tag_id)
      );
    }
  }

  // 5. Copy rules, then their examples, tags and related-rule links.
  const templateRules = await db
    .prepare(
      "SELECT id, kind, title, explanation, pattern, points, notes, created_at, important FROM rules WHERE owner_id IS NULL"
    )
    .all<{
      id: number;
      kind: "word" | "sentence";
      title: string;
      explanation: string;
      pattern: string | null;
      points: string | null;
      notes: string | null;
      created_at: number;
      important: number;
    }>();
  const ruleIdMap = new Map<number, number>();
  const ruleStatements: D1PreparedStatement[] = [];
  for (const rule of templateRules.results ?? []) {
    ruleStatements.push(
      db
        .prepare(
          "INSERT INTO rules (kind, title, explanation, pattern, points, notes, created_by, created_at, important, owner_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        )
        .bind(
          rule.kind,
          rule.title,
          rule.explanation,
          rule.pattern,
          rule.points,
          rule.notes ?? null,
          ownerId,
          rule.created_at || now,
          rule.important ?? 0,
          ownerId
        )
    );
  }
  if (ruleStatements.length > 0) {
    const inserted = await db.batch(ruleStatements);
    templateRules.results?.forEach((rule, index) => {
      ruleIdMap.set(rule.id, inserted[index]?.meta.last_row_id ?? 0);
    });
  }

  for (const [oldRuleId, newRuleId] of ruleIdMap) {
    if (!newRuleId) continue;
    const examples = await db
      .prepare(
        "SELECT japanese, english, english_equivalent FROM rule_examples WHERE rule_id = ?1"
      )
      .bind(oldRuleId)
      .all<{ japanese: string; english: string; english_equivalent: string | null }>();
    for (const row of examples.results ?? []) {
      childStatements.push(
        db
          .prepare(
            "INSERT INTO rule_examples (rule_id, japanese, english, english_equivalent) VALUES (?1, ?2, ?3, ?4)"
          )
          .bind(newRuleId, row.japanese, row.english, row.english_equivalent ?? null)
      );
    }
    const tagLinks = await db
      .prepare("SELECT tag_id FROM rule_tags WHERE rule_id = ?1")
      .bind(oldRuleId)
      .all<{ tag_id: number }>();
    for (const row of tagLinks.results ?? []) {
      childStatements.push(
        db
          .prepare("INSERT OR IGNORE INTO rule_tags (rule_id, tag_id) VALUES (?1, ?2)")
          .bind(newRuleId, row.tag_id)
      );
    }
    const related = await db
      .prepare("SELECT related_rule_id FROM rule_related WHERE rule_id = ?1")
      .bind(oldRuleId)
      .all<{ related_rule_id: number }>();
    for (const row of related.results ?? []) {
      const newRelatedId = ruleIdMap.get(row.related_rule_id);
      if (newRelatedId && newRelatedId !== newRuleId) {
        childStatements.push(
          db
            .prepare("INSERT OR IGNORE INTO rule_related (rule_id, related_rule_id) VALUES (?1, ?2)")
            .bind(newRuleId, newRelatedId)
        );
      }
    }
  }

  if (childStatements.length > 0) {
    await db.batch(childStatements);
  }

  // The home page was rendered moments ago (that is where the button lives),
  // so this owner's empty tag list is almost certainly still cached.
  invalidateTagLookups(ownerId);

  await setStarterChoice(ownerId, true);
  return {
    lists: listIdMap.size,
    words: wordIdMap.size,
    rules: ruleIdMap.size,
  };
}

/**
 * Move every content row owned by `fromOwner` (a signed-out device id) to
 * `toOwner` (the account that just signed in). Children follow their parent
 * rows. Returns the number of moved top-level rows.
 */
export async function reownerContent(fromOwner: string, toOwner: string): Promise<number> {
  const db = getDb();
  const [words, lists, rules] = await Promise.all([
    db
      .prepare("UPDATE words SET owner_id = ?1, created_by = ?1 WHERE owner_id = ?2")
      .bind(toOwner, fromOwner)
      .run(),
    db
      .prepare("UPDATE word_lists SET owner_id = ?1, created_by = ?1 WHERE owner_id = ?2")
      .bind(toOwner, fromOwner)
      .run(),
    db
      .prepare("UPDATE rules SET owner_id = ?1, created_by = ?1 WHERE owner_id = ?2")
      .bind(toOwner, fromOwner)
      .run(),
  ]);
  // Tags travel with their lists and rules, so both sides of the move have a
  // stale tag list now: the account gains them, the device id loses them.
  invalidateTagLookups(fromOwner);
  invalidateTagLookups(toOwner);
  return (
    (words.meta.changes ?? 0) + (lists.meta.changes ?? 0) + (rules.meta.changes ?? 0)
  );
}

export async function listWords(
  ownerId: string,
  search: string | null,
  page: number,
  pos?: string | null,
  excludePos?: string | null
): Promise<Paginated<WordSummary>> {
  const db = getDb();
  const params: (string | number)[] = [ownerId];
  let clause = "WHERE w.owner_id = ?";
  if (search) {
    const like = `%${search}%`;
    params.push(like, like);
    clause += " AND (w.word LIKE ? OR w.kana LIKE ?)";
  }
  if (pos) {
    clause += " AND w.pos = ?";
    params.push(pos);
  }
  if (excludePos) {
    clause += " AND (w.pos IS NULL OR w.pos <> ?)";
    params.push(excludePos);
  }

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM words w ${clause}`);
  const totalResult = await countStmt.bind(...params).first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const listStmt = db.prepare(
    `SELECT w.id, w.word, w.kana, w.created_at, w.pos, w.subtype,
            (SELECT m.meaning FROM meanings m WHERE m.word_id = w.id LIMIT 1) AS meaning,
            w.list_id, l.title AS list_title
     FROM words w
     LEFT JOIN word_lists l ON l.id = w.list_id
     ${clause}
     ORDER BY w.id ASC
     LIMIT ? OFFSET ?`
  );
  const { results } = await listStmt
    .bind(...params, PAGE_SIZE, offset)
    .all<WordRow & { meaning: string | null; list_id: number | null; list_title: string | null }>();

  return {
    items: (results ?? []).map((row) => ({
      id: row.id,
      word: row.word,
      kana: row.kana,
      pos: row.pos,
      subtype: row.subtype,
      meaning: row.meaning,
      createdAt: row.created_at,
      listId: row.list_id,
      listTitle: row.list_title,
    })),
    page: safePage,
    pageSize: PAGE_SIZE,
    total,
    pages,
  };
}

/** Parse the `words.forms` JSON column, tolerating a null/empty value. */
function parseWordForms(raw: string | null): WordForm[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is { name?: unknown; value?: unknown } =>
          !!item && typeof item === "object"
      )
      .map((item) => ({
        name: typeof item.name === "string" ? item.name.trim() : "",
        value: typeof item.value === "string" ? item.value.trim() : "",
      }))
      .filter((form) => form.name.length > 0 || form.value.length > 0)
      .slice(0, MAX_WORD_FORMS);
  } catch {
    return [];
  }
}

/** Serialize forms back into the `words.forms` JSON column (null when empty). */
function serializeWordForms(forms: WordForm[]): string | null {
  const list = forms
    .map((form) => ({
      name: form.name.trim(),
      value: form.value.trim(),
    }))
    .filter((form) => form.name.length > 0 || form.value.length > 0)
    .slice(0, MAX_WORD_FORMS);
  return list.length > 0 ? JSON.stringify(list) : null;
}

export async function getWord(ownerId: string, id: number): Promise<WordDetail | null> {
  const db = getDb();
  const row = await db
    .prepare(
      `SELECT w.id, w.word, w.kana, w.created_by, w.created_at, w.pos, w.subtype, w.list_id,
              w.notes, w.forms,
              l.title AS list_title, l.created_by AS list_author
       FROM words w
       LEFT JOIN word_lists l ON l.id = w.list_id
       WHERE w.id = ?1 AND w.owner_id = ?2`
    )
    .bind(id, ownerId)
    .first<
      WordRow & {
        list_id: number | null;
        list_title: string | null;
        list_author: string | null;
        notes: string | null;
        forms: string | null;
      }
    >();
  if (!row) return null;

  const [meanings, examples] = await Promise.all([
    db
      .prepare("SELECT meaning FROM meanings WHERE word_id = ?1 ORDER BY id ASC")
      .bind(id)
      .all<{ meaning: string }>(),
    db
      .prepare("SELECT id, japanese, translation FROM examples WHERE word_id = ?1 ORDER BY id ASC")
      .bind(id)
      .all<{ id: number; japanese: string; translation: string | null }>(),
  ]);

  return {
    id: row.id,
    word: row.word,
    kana: row.kana,
    pos: row.pos,
    subtype: row.subtype,
    meaning: meanings.results?.[0]?.meaning ?? null,
    meanings: (meanings.results ?? []).map((m) => m.meaning),
    examples: examples.results ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    listId: row.list_id,
    listTitle: row.list_title,
    listAuthor: row.list_author,
    notes: row.notes,
    forms: parseWordForms(row.forms),
  };
}

export async function listExamples(ownerId: string, page: number): Promise<Paginated<ExampleItem>> {
  const db = getDb();
  const PAGE = 20;

  const totalResult = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM examples e
       JOIN words w ON w.id = e.word_id
       WHERE w.owner_id = ?1`
    )
    .bind(ownerId)
    .first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * PAGE;

  const { results } = await db
    .prepare(
      `SELECT e.id, e.japanese, e.translation, e.word_id, w.word, w.kana
       FROM examples e
       JOIN words w ON w.id = e.word_id
       WHERE w.owner_id = ?1
       ORDER BY e.id ASC
       LIMIT ?2 OFFSET ?3`
    )
    .bind(ownerId, PAGE, offset)
    .all<ExampleItem>();

  return {
    items: results ?? [],
    page: safePage,
    pageSize: PAGE,
    total,
    pages,
  };
}

/** All word lists with tags and word counts (no pagination — for the study setup page). */
export async function listAllLists(ownerId: string): Promise<WordListSummary[]> {
  const db = getDb();
  const { results } = await db
    .prepare(
      `SELECT wl.id, wl.title, wl.description, wl.created_by, wl.created_at,
              (SELECT COUNT(*) FROM words w WHERE w.list_id = wl.id) AS word_count
       FROM word_lists wl
       WHERE wl.owner_id = ?1
       ORDER BY wl.created_at DESC, wl.id DESC`
    )
    .bind(ownerId)
    .all<{ id: number; title: string; description: string | null; created_by: string | null; created_at: number; word_count: number }>();

  const lists = results ?? [];
  const tagMap = await loadTagsForLists(db, lists.map((l) => l.id));

  return lists.map((l) => ({
    id: l.id,
    title: l.title,
    description: l.description,
    createdAt: l.created_at,
    createdBy: l.created_by,
    wordCount: l.word_count,
    tags: tagMap.get(l.id) ?? [],
  }));
}

/** Normalise tag names the way the join tables store them. */
function cleanTagNames(names: string[] | null | undefined): string[] {
  if (!names) return [];
  return names
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
}

/**
 * Ids of lists matching the tag filter.
 *
 * `include` is a union: a list carrying *any* of the named tags is in. `exclude`
 * is a subtraction applied afterwards, so a list tagged both `#n5` and
 * `#archived` is dropped by excluding `#archived` even when `#n5` was asked
 * for. With no include tags this is "every list except the excluded ones" —
 * which is the whole point of offering exclusion on its own.
 */
export async function listIdsByTags(
  ownerId: string,
  include: string[],
  exclude: string[] = []
): Promise<number[]> {
  const wanted = cleanTagNames(include);
  const unwanted = cleanTagNames(exclude);
  if (wanted.length === 0 && unwanted.length === 0) return [];

  const db = getDb();
  const params: (string | number)[] = [ownerId];
  const clauses: string[] = ["wl.owner_id = ?1"];

  if (wanted.length > 0) {
    params.push(...wanted);
    clauses.push(
      `EXISTS (SELECT 1 FROM word_list_tags wlt JOIN tags t ON t.id = wlt.tag_id
               WHERE wlt.list_id = wl.id AND t.name IN (${wanted.map(() => "?").join(", ")}))`
    );
  }
  if (unwanted.length > 0) {
    params.push(...unwanted);
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM word_list_tags wlt JOIN tags t ON t.id = wlt.tag_id
                   WHERE wlt.list_id = wl.id AND t.name IN (${unwanted.map(() => "?").join(", ")}))`
    );
  }

  const { results } = await db
    .prepare(
      `SELECT wl.id AS id FROM word_lists wl
       WHERE ${clauses.join(" AND ")}
       ORDER BY wl.id ASC`
    )
    .bind(...params)
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

/** Ids of every word list belonging to the owner. */
export async function listAllListIds(ownerId: string): Promise<number[]> {
  const db = getDb();
  const { results } = await db
    .prepare("SELECT id FROM word_lists WHERE owner_id = ?1")
    .bind(ownerId)
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

/** Which vocabulary a list-based study session drills. */
export type StudyListKind = "words" | "phrases";

/**
 * SQL predicate selecting the cards of a study kind: phrases are `words` rows
 * with `pos = 'phrase'`, everything else (including unset parts of speech) is a
 * word.
 */
function studyKindClause(kind: StudyListKind): string {
  return kind === "phrases" ? "pos = 'phrase'" : "(pos IS NULL OR pos <> 'phrase')";
}

/** Attach tags to a set of lists (single extra query, no N+1). */
export interface StudyLibrary {
  /** Lists holding at least one non-phrase word. */
  wordLists: WordListSummary[];
  /** Lists holding at least one phrase. */
  phraseLists: WordListSummary[];
}

/**
 * The word and phrase libraries used by the study tabs. A list can appear in
 * both, with `wordCount` reflecting only the words relevant to that tab.
 *
 * Nothing here knows about stars: starring is per-user and lives in Convex, so
 * the study UI layers it on client-side.
 */
export async function listStudyLists(ownerId: string): Promise<StudyLibrary> {
  const db = getDb();
  const lists = await listAllLists(ownerId);

  const { results } = await db
    .prepare(
      `SELECT list_id AS id,
              SUM(CASE WHEN pos = 'phrase' THEN 1 ELSE 0 END) AS phrases,
              SUM(CASE WHEN pos IS NULL OR pos <> 'phrase' THEN 1 ELSE 0 END) AS words
       FROM words
       WHERE list_id IS NOT NULL AND owner_id = ?1
       GROUP BY list_id`
    )
    .bind(ownerId)
    .all<{ id: number; phrases: number; words: number }>();

  const counts = new Map((results ?? []).map((row) => [row.id, row]));
  const wordLists: WordListSummary[] = [];
  const phraseLists: WordListSummary[] = [];

  for (const list of lists) {
    const count = counts.get(list.id);
    if (!count) continue;
    if (count.words > 0) wordLists.push({ ...list, wordCount: count.words });
    if (count.phrases > 0) phraseLists.push({ ...list, wordCount: count.phrases });
  }

  return { wordLists, phraseLists };
}

/**
 * `id IN (…)` for an explicit card-id filter (the signed-in user's starred
 * ids). Returns null when there is no filter, and `0` when the filter is empty
 * — a clause that deliberately matches nothing.
 */
function cardIdClause(ids: CardIdFilter, params: (string | number)[]): string | null {
  if (ids == null) return null;
  const clean = ids.filter((id) => Number.isInteger(id));
  if (clean.length === 0) return "0";
  params.push(...clean);
  return `id IN (${clean.map(() => "?").join(", ")})`;
}

/**
 * The tag half of a rules `WHERE`, as a single clause.
 *
 * `EXISTS (…)` narrows to rules carrying any of the included tags; the
 * `NOT EXISTS (…)` that follows drops any rule carrying an excluded one, so
 * excluding a tag removes a rule even when it matched an include. Both halves
 * are pushed onto `params` in the order they appear in the string, which is
 * what keeps the positional placeholders lined up.
 *
 * Returns null when neither list names a usable tag, so the caller can leave
 * the clause out rather than filter on nothing. A list that is present but
 * entirely blank counts as "no filter" rather than "match nothing": it can only
 * arrive from a malformed client, and silently emptying the quiz is a worse
 * answer than ignoring it.
 */
function ruleTagClause(
  tags: string[] | null | undefined,
  excludedTags: string[] | null | undefined,
  params: (string | number)[]
): string | null {
  const wanted = cleanTagNames(tags);
  const unwanted = cleanTagNames(excludedTags);
  const parts: string[] = [];

  if (wanted.length > 0) {
    params.push(...wanted);
    parts.push(
      `EXISTS (SELECT 1 FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = rules.id AND t.name IN (${wanted.map(() => "?").join(", ")}))`
    );
  }
  if (unwanted.length > 0) {
    params.push(...unwanted);
    parts.push(
      `NOT EXISTS (SELECT 1 FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = rules.id AND t.name IN (${unwanted.map(() => "?").join(", ")}))`
    );
  }

  return parts.length > 0 ? parts.join(" AND ") : null;
}

/** How many cards of the given kind exist across the given lists. */
export async function countWordsInLists(
  ownerId: string,
  listIds: number[],
  pos?: string | null,
  kind: StudyListKind = "words",
  starredIds?: CardIdFilter
): Promise<number> {
  if (listIds.length === 0) return 0;
  const db = getDb();
  const placeholders = listIds.map(() => "?").join(", ");
  const params: (string | number)[] = [ownerId, ...listIds];
  let clause = `owner_id = ? AND list_id IN (${placeholders}) AND ${studyKindClause(kind)}`;
  if (pos) {
    clause += " AND pos = ?";
    params.push(pos);
  }
  const idClause = cardIdClause(starredIds, params);
  if (idClause) clause += ` AND ${idClause}`;
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM words WHERE ${clause}`)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getStudyDeck(
  ownerId: string,
  listIds: number[],
  limit = 40,
  pos?: string | null,
  kind: StudyListKind = "words",
  starredIds?: CardIdFilter
): Promise<WordDetail[]> {
  const db = getDb();
  if (listIds.length === 0) return [];

  const placeholders = listIds.map(() => "?").join(", ");
  const params: (string | number)[] = [ownerId, ...listIds];
  let clause = `owner_id = ? AND list_id IN (${placeholders}) AND ${studyKindClause(kind)}`;
  if (pos) {
    clause += " AND pos = ?";
    params.push(pos);
  }
  const idClause = cardIdClause(starredIds, params);
  if (idClause) clause += ` AND ${idClause}`;
  const { results } = await db
    .prepare(`SELECT id FROM words WHERE ${clause} ORDER BY RANDOM() LIMIT ?`)
    .bind(...params, limit)
    .all<{ id: number }>();
  const ids = (results ?? []).map((r) => r.id);
  const details = await Promise.all(ids.map((id) => getWord(ownerId, id)));
  return details.filter((d): d is WordDetail => d !== null);
}

export interface InsertResult {
  wordsInserted: number;
  meaningsInserted: number;
  examplesInserted: number;
}

/** Create a word list and attach (creating if needed) the given tag names. */
export async function createWordList(
  ownerId: string,
  title: string,
  description: string | null,
  tags: string[]
): Promise<number> {
  const db = getDb();
  const listResult = await db
    .prepare(
      "INSERT INTO word_lists (title, description, created_by, owner_id) VALUES (?1, ?2, ?3, ?4)"
    )
    .bind(title, description, ownerId, ownerId)
    .run();
  const listId = listResult.meta.last_row_id;

  if (tags.length > 0) {
    const insertTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?1)");
    const selectTag = db.prepare("SELECT id FROM tags WHERE name = ?1");
    const insertJoin = db.prepare(
      "INSERT OR IGNORE INTO word_list_tags (list_id, tag_id) VALUES (?1, ?2)"
    );

    for (const tag of tags) {
      await insertTag.bind(tag).run();
      const tagRow = await selectTag.bind(tag).first<{ id: number }>();
      if (tagRow) {
        await insertJoin.bind(listId, tagRow.id).run();
      }
    }
  }

  invalidateTagLookups(ownerId);
  return listId;
}

async function loadTagsForLists(db: D1Database, listIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (listIds.length === 0) return map;

  const placeholders = listIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT wlt.list_id, t.name
       FROM word_list_tags wlt
       JOIN tags t ON t.id = wlt.tag_id
       WHERE wlt.list_id IN (${placeholders})
       ORDER BY t.name ASC`
    )
    .bind(...listIds)
    .all<{ list_id: number; name: string }>();

  for (const row of results ?? []) {
    const tags = map.get(row.list_id) ?? [];
    tags.push(row.name);
    map.set(row.list_id, tags);
  }
  return map;
}

const LIST_PAGE_SIZE = 12;

export async function listWordLists(
  ownerId: string,
  page: number,
  tag?: string | null,
  pos?: string | null,
  excludePos?: string | null
): Promise<Paginated<WordListSummary>> {
  const db = getDb();
  const params: (string | number)[] = [ownerId];
  let clause = "WHERE wl.owner_id = ?";
  if (tag) {
    params.push(`%${tag.toLowerCase()}%`);
    clause +=
      " AND EXISTS (SELECT 1 FROM word_list_tags wlt JOIN tags t ON t.id = wlt.tag_id WHERE wlt.list_id = wl.id AND t.name LIKE ?)";
  }
  if (pos) {
    clause += " AND EXISTS (SELECT 1 FROM words w WHERE w.list_id = wl.id AND w.pos = ?)";
    params.push(pos);
  }
  if (excludePos) {
    clause += " AND NOT EXISTS (SELECT 1 FROM words w WHERE w.list_id = wl.id AND w.pos = ?)";
    params.push(excludePos);
  }

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM word_lists wl ${clause}`);
  const totalResult = await countStmt.bind(...params).first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * LIST_PAGE_SIZE;

  const listStmt = db.prepare(
    `SELECT wl.id, wl.title, wl.description, wl.created_by, wl.created_at,
            (SELECT COUNT(*) FROM words w WHERE w.list_id = wl.id) AS word_count
     FROM word_lists wl ${clause}
     ORDER BY wl.created_at DESC, wl.id DESC
     LIMIT ? OFFSET ?`
  );
  const { results } = await listStmt
    .bind(...params, LIST_PAGE_SIZE, offset)
    .all<{ id: number; title: string; description: string | null; created_by: string | null; created_at: number; word_count: number }>();

  const lists = results ?? [];
  const tagMap = await loadTagsForLists(db, lists.map((l) => l.id));

  return {
    items: lists.map((l) => ({
      id: l.id,
      title: l.title,
      description: l.description,
      createdAt: l.created_at,
      createdBy: l.created_by,
      wordCount: l.word_count,
      tags: tagMap.get(l.id) ?? [],
    })),
    page: safePage,
    pageSize: LIST_PAGE_SIZE,
    total,
    pages,
  };
}

export interface TagInfo {
  name: string;
  listCount: number;
}

/**
 * Tiny in-isolate cache for read-mostly lookups. Cloudflare keeps a Worker
 * isolate warm between requests, so the second request in the same isolate
 * answers from this map instead of paying another D1 round-trip (`listAllTags`
 * and `listAllRuleTags` run on almost every page).
 *
 * The window is deliberately short: a tag edit can take up to this long to show
 * up in another isolate, and the cache is per-isolate, so it is a latency fix,
 * not a correctness source of truth.
 */
const LOOKUP_CACHE_MS = 20_000;
const lookupCache = new Map<string, { at: number; value: unknown }>();

/**
 * Soft cap on the number of cached entries.
 *
 * `cachedLookup` replaces an entry on re-read but never removes one, so an
 * owner who is not seen again leaves their entry behind for the lifetime of the
 * isolate. The cache is keyed per owner, so without a cap it grows with the
 * number of distinct owners the isolate has ever served — small per entry, but
 * unbounded, and a Worker isolate can live a long time.
 *
 * Pruning is opportunistic: it runs only when the map is over the cap, and the
 * window is short, so by then most of what is in there is already dead.
 */
const LOOKUP_CACHE_MAX = 500;

function pruneLookupCache(now: number): void {
  if (lookupCache.size <= LOOKUP_CACHE_MAX) return;

  for (const [key, entry] of lookupCache) {
    if (now - entry.at >= LOOKUP_CACHE_MS) lookupCache.delete(key);
  }

  // A burst of fresh owners can leave nothing expired. Map iteration is
  // insertion order, so this evicts oldest-first to keep the bound real.
  while (lookupCache.size > LOOKUP_CACHE_MAX) {
    const oldest = lookupCache.keys().next().value;
    if (oldest === undefined) break;
    lookupCache.delete(oldest);
  }
}

async function cachedLookup<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = lookupCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < LOOKUP_CACHE_MS) return hit.value as T;
  const value = await load();
  lookupCache.set(key, { at: now, value });
  pruneLookupCache(now);
  return value;
}

/**
 * Drop an owner's cached tag lists.
 *
 * The cache is a latency fix, but it is invisible to writes: without this, the
 * value loaded *before* a write keeps being served until the window lapses.
 * The visible symptom is the tag popover. Copying the starter pack loads the
 * home page first (an empty owner → `[]` is cached), then inserts the pack, so
 * the popover reads "No tags yet." for the next 20 seconds — the tags are in
 * D1 the whole time. The same lag applies to adding or removing a tag.
 *
 * Callers pass the owner whose content changed; every write path below that
 * can alter a tag set drops its own entries instead of waiting out the window.
 */
function invalidateTagLookups(ownerId: string): void {
  lookupCache.delete(`listAllTags:${ownerId}`);
  lookupCache.delete(`listAllRuleTags:${ownerId}`);
}

/**
 * All tags used by the owner's word lists, with list counts — powers the tag
 * search UI. Scoped to the owner so tag usage never leaks across accounts.
 */
export async function listAllTags(ownerId: string): Promise<TagInfo[]> {
  return cachedLookup(`listAllTags:${ownerId}`, async () => {
    const db = getDb();
    const { results } = await db
      .prepare(
        `SELECT t.name, COUNT(wlt.list_id) AS list_count
         FROM tags t
         JOIN word_list_tags wlt ON wlt.tag_id = t.id
         JOIN word_lists wl ON wl.id = wlt.list_id
         WHERE wl.owner_id = ?1
         GROUP BY t.id
         ORDER BY list_count DESC, t.name ASC`
      )
      .bind(ownerId)
      .all<{ name: string; list_count: number }>();
    return (results ?? []).map((row) => ({ name: row.name, listCount: row.list_count }));
  });
}

export async function getWordList(ownerId: string, id: number): Promise<WordListDetail | null> {
  const db = getDb();
  // The list row, its words and its tags have no dependency on each other, so
  // they go out together instead of as three sequential round-trips.
  const [list, words, tagMap] = await Promise.all([
    db
      .prepare(
        "SELECT id, title, description, created_by, created_at FROM word_lists WHERE id = ?1 AND owner_id = ?2"
      )
      .bind(id, ownerId)
      .first<{ id: number; title: string; description: string | null; created_by: string | null; created_at: number }>(),
    db
      .prepare(
        `SELECT w.id, w.word, w.kana, w.created_at, w.pos, w.subtype,
                (SELECT m.meaning FROM meanings m WHERE m.word_id = w.id LIMIT 1) AS meaning,
                w.list_id, l.title AS list_title
         FROM words w
         LEFT JOIN word_lists l ON l.id = w.list_id
         WHERE w.list_id = ?1 AND w.owner_id = ?2
         ORDER BY w.id ASC`
      )
      .bind(id, ownerId)
      .all<WordRow & { meaning: string | null; list_id: number | null; list_title: string | null }>()
      .then((result) => result.results ?? []),
    loadTagsForLists(db, [id]),
  ]);
  if (!list) return null;

  return {
    id: list.id,
    title: list.title,
    description: list.description,
    createdAt: list.created_at,
    createdBy: list.created_by,
    wordCount: words.length,
    tags: tagMap.get(id) ?? [],
    words: words.map((row) => ({
      id: row.id,
      word: row.word,
      kana: row.kana,
      pos: row.pos,
      subtype: row.subtype,
      meaning: row.meaning,
      createdAt: row.created_at,
      listId: row.list_id,
      listTitle: row.list_title,
    })),
  };
}

export async function insertVocabEntries(
  ownerId: string,
  entries: VocabEntry[],
  listId: number | null
): Promise<InsertResult> {
  const db = getDb();
  const insertWord = db.prepare(
    "INSERT INTO words (word, kana, pos, subtype, created_by, list_id, owner_id, notes, forms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
  );
  const insertMeaning = db.prepare("INSERT INTO meanings (word_id, meaning) VALUES (?1, ?2)");
  const insertExample = db.prepare("INSERT INTO examples (word_id, japanese, translation) VALUES (?1, ?2, ?3)");

  // Two-phase: insert words first (to learn their ids), then children.
  const wordResults = await db.batch(
    entries.map((entry) =>
      insertWord.bind(
        entry.word,
        entry.kana,
        entry.pos,
        entry.subtype ?? null,
        ownerId,
        listId,
        ownerId,
        entry.notes ?? null,
        serializeWordForms(entry.forms ?? [])
      )
    )
  );
  const wordIds = wordResults.map((r) => r.meta.last_row_id);

  const statements: D1PreparedStatement[] = [];
  let meaningsInserted = 0;
  let examplesInserted = 0;

  entries.forEach((entry, i) => {
    const wordId = wordIds[i];
    for (const meaning of entry.meanings) {
      statements.push(insertMeaning.bind(wordId, meaning));
      meaningsInserted++;
    }
    for (const example of entry.examples) {
      statements.push(insertExample.bind(wordId, example.japanese, example.translation));
      examplesInserted++;
    }
  });

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return { wordsInserted: entries.length, meaningsInserted, examplesInserted };
}

/** The word's owner id, or null when it does not exist. */
async function getWordOwnerId(wordId: number): Promise<string | null> {
  const db = getDb();
  const row = await db
    .prepare("SELECT owner_id FROM words WHERE id = ?1")
    .bind(wordId)
    .first<{ owner_id: string | null }>();
  return row?.owner_id ?? null;
}

/** Whether the given owner may edit this word (they must own it). */
export async function canEditWord(ownerId: string, wordId: number): Promise<boolean> {
  return (await getWordOwnerId(wordId)) === ownerId;
}

/** Update a word list's metadata. Tags are replaced as a whole set. */
export async function updateWordList(
  ownerId: string,
  listId: number,
  title: string,
  description: string | null,
  tags: string[]
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .prepare("UPDATE word_lists SET title = ?1, description = ?2 WHERE id = ?3 AND owner_id = ?4")
    .bind(title, description, listId, ownerId)
    .run();
  if (result.meta.changes === 0) return false;

  // Replace the tag set (tag rows themselves are shared and never deleted).
  await db.prepare("DELETE FROM word_list_tags WHERE list_id = ?1").bind(listId).run();
  const insertTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?1)");
  const selectTag = db.prepare("SELECT id FROM tags WHERE name = ?1");
  const insertJoin = db.prepare(
    "INSERT OR IGNORE INTO word_list_tags (list_id, tag_id) VALUES (?1, ?2)"
  );
  for (const tag of tags) {
    await insertTag.bind(tag).run();
    const tagRow = await selectTag.bind(tag).first<{ id: number }>();
    if (tagRow) {
      await insertJoin.bind(listId, tagRow.id).run();
    }
  }
  invalidateTagLookups(ownerId);
  return true;
}

/**
 * Detach entries from a list without deleting them: the word keeps its meanings
 * and examples, it just stops belonging to the list (`words.list_id` → NULL) —
 * the same outcome as deleting the whole list. Scoped to `listId` and the owner
 * so a stray id can't pull a word out of a different owner's list. Returns how
 * many rows were removed.
 */
export async function removeWordsFromList(
  ownerId: string,
  listId: number,
  wordIds: number[]
): Promise<number> {
  if (wordIds.length === 0) return 0;
  const db = getDb();
  const placeholders = wordIds.map((_, index) => `?${index + 3}`).join(", ");
  const result = await db
    .prepare(
      `UPDATE words SET list_id = NULL WHERE owner_id = ?1 AND list_id = ?2 AND id IN (${placeholders})`
    )
    .bind(ownerId, listId, ...wordIds)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Delete a word list. Its words are kept but detached
 * (`words.list_id REFERENCES word_lists(id) ON DELETE SET NULL`), and the
 * word_list_tags join rows cascade away.
 */
export async function deleteWordList(ownerId: string, listId: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .prepare("DELETE FROM word_lists WHERE id = ?1 AND owner_id = ?2")
    .bind(listId, ownerId)
    .run();
  // A deleted list can take the last use of a tag with it (the join rows
  // cascade), so the tag filter has to be rebuilt.
  if (result.meta.changes > 0) invalidateTagLookups(ownerId);
  return result.meta.changes > 0;
}

export interface WordUpdateInput {
  word: string;
  kana: string;
  pos: string | null;
  /** Refines pos; null = clear. */
  subtype: string | null;
  meanings: string[];
  examples: { japanese: string; translation: string | null }[];
  /** Free-text notes (null = clear). */
  notes: string | null;
  /** Conjugation forms, in display order (empty = clear). */
  forms: WordForm[];
}

/** Update a word's core fields and replace its meanings/examples wholesale. */
export async function updateWord(
  ownerId: string,
  wordId: number,
  data: WordUpdateInput
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .prepare(
      "UPDATE words SET word = ?1, kana = ?2, pos = ?3, subtype = ?4, notes = ?5, forms = ?6 WHERE id = ?7 AND owner_id = ?8"
    )
    .bind(
      data.word,
      data.kana,
      data.pos,
      data.subtype ?? null,
      data.notes ?? null,
      serializeWordForms(data.forms),
      wordId,
      ownerId
    )
    .run();
  if (result.meta.changes === 0) return false;

  await db.batch([
    db.prepare("DELETE FROM meanings WHERE word_id = ?1").bind(wordId),
    db.prepare("DELETE FROM examples WHERE word_id = ?1").bind(wordId),
  ]);

  const statements: D1PreparedStatement[] = [
    ...data.meanings.map((m) =>
      db.prepare("INSERT INTO meanings (word_id, meaning) VALUES (?1, ?2)").bind(wordId, m)
    ),
    ...data.examples.map((e) =>
      db
        .prepare("INSERT INTO examples (word_id, japanese, translation) VALUES (?1, ?2, ?3)")
        .bind(wordId, e.japanese, e.translation)
    ),
  ];
  if (statements.length > 0) {
    await db.batch(statements);
  }
  return true;
}

/** Delete a word together with its meanings and examples (cascade). */
export async function deleteWord(ownerId: string, wordId: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .prepare("DELETE FROM words WHERE id = ?1 AND owner_id = ?2")
    .bind(wordId, ownerId)
    .run();
  return result.meta.changes > 0;
}

// ---------------------------------------------------------------------------
// Rules (grammar): word rules & sentence rules — private to their owner.
// ---------------------------------------------------------------------------

export type RuleKind = "word" | "sentence";

export interface RuleExample {
  japanese: string;
  /** The English translation of the example sentence — what it means. */
  english: string;
  /**
   * The English *equivalent* of the grammar shown, i.e. how the same idea is
   * said in English (what the rule page breaks the sentence down into).
   * NULL = not written yet.
   */
  englishEquivalent: string | null;
}

export interface RuleSummary {
  id: number;
  kind: RuleKind;
  title: string;
  explanation: string;
  /** Up to four ポイント (point!) lines, in display order. */
  points: string[];
  createdAt: number;
  exampleCount: number;
  tags: string[];
  /** Free-text notes about this rule (null = none). */
  notes: string | null;
}

/** A rule linked to another one. */
export interface RelatedRule {
  id: number;
  kind: RuleKind;
  title: string;
}

export interface RuleDetail extends RuleSummary {
  examples: RuleExample[];
  /** Curated on the rule form — nothing here is inferred. */
  related: RelatedRule[];
}

const RULE_PAGE_SIZE = 15;
/** Kept in step with `MAX_POINTS` in `~/lib/rule-draft`. */
const MAX_RULE_POINTS = 4;

/**
 * Read the `points` JSON column, falling back to the legacy single `pattern`
 * column for rows saved before the rule could carry more than one point.
 */
function parseRulePoints(points: string | null, pattern: string | null): string[] {
  if (points) {
    try {
      const parsed: unknown = JSON.parse(points);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((point): point is string => typeof point === "string")
          .map((point) => point.trim())
          .filter((point) => point.length > 0)
          .slice(0, MAX_RULE_POINTS);
      }
    } catch {
      // Not JSON — fall through to the legacy column below.
    }
  }
  return pattern && pattern.trim() ? [pattern] : [];
}

/** Both columns are written together so `pattern` always mirrors point one. */
function serializeRulePoints(points: string[]): { pattern: string | null; points: string | null } {
  const list = points
    .map((point) => point.trim())
    .filter((point) => point.length > 0)
    .slice(0, MAX_RULE_POINTS);
  return {
    pattern: list[0] ?? null,
    points: list.length > 0 ? JSON.stringify(list) : null,
  };
}

/** Attach tags to a set of rules (single extra query, no N+1). */
async function loadTagsForRules(db: D1Database, ruleIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (ruleIds.length === 0) return map;

  const placeholders = ruleIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT rt.rule_id, t.name
       FROM rule_tags rt
       JOIN tags t ON t.id = rt.tag_id
       WHERE rt.rule_id IN (${placeholders})
       ORDER BY t.name ASC`
    )
    .bind(...ruleIds)
    .all<{ rule_id: number; name: string }>();

  for (const row of results ?? []) {
    const tags = map.get(row.rule_id) ?? [];
    tags.push(row.name);
    map.set(row.rule_id, tags);
  }
  return map;
}

/** Replace a rule's tag set (tag rows themselves are shared and never deleted). */
async function setRuleTags(db: D1Database, ruleId: number, tags: string[]): Promise<void> {
  await db.prepare("DELETE FROM rule_tags WHERE rule_id = ?1").bind(ruleId).run();
  if (tags.length === 0) return;

  const insertTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?1)");
  const selectTag = db.prepare("SELECT id FROM tags WHERE name = ?1");
  const insertJoin = db.prepare(
    "INSERT OR IGNORE INTO rule_tags (rule_id, tag_id) VALUES (?1, ?2)"
  );
  for (const tag of tags) {
    await insertTag.bind(tag).run();
    const tagRow = await selectTag.bind(tag).first<{ id: number }>();
    if (tagRow) await insertJoin.bind(ruleId, tagRow.id).run();
  }
}

/** Tags actually used by the owner's rules — powers the rules page tag filter. */
export async function listAllRuleTags(ownerId: string): Promise<TagInfo[]> {
  return cachedLookup(`listAllRuleTags:${ownerId}`, async () => {
    const db = getDb();
    const { results } = await db
      .prepare(
        `SELECT t.name, COUNT(rt.rule_id) AS list_count
         FROM tags t
         JOIN rule_tags rt ON rt.tag_id = t.id
         JOIN rules r ON r.id = rt.rule_id
         WHERE r.owner_id = ?1
         GROUP BY t.id
         ORDER BY list_count DESC, t.name ASC`
      )
      .bind(ownerId)
      .all<{ name: string; list_count: number }>();
    return (results ?? []).map((row) => ({ name: row.name, listCount: row.list_count }));
  });
}

export async function listRules(
  ownerId: string,
  kind: RuleKind | null,
  page: number,
  search: string | null = null,
  tag: string | null = null
): Promise<Paginated<RuleSummary>> {
  const db = getDb();
  const params: (string | number)[] = [ownerId];
  const clauses: string[] = ["r.owner_id = ?"];

  if (kind) {
    clauses.push("r.kind = ?");
    params.push(kind);
  }
  if (search) {
    clauses.push(
      "(r.title LIKE ? OR r.explanation LIKE ? OR r.pattern LIKE ? OR r.points LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (tag) {
    clauses.push(
      "EXISTS (SELECT 1 FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = r.id AND t.name = ?)"
    );
    params.push(tag);
  }
  const clause = `WHERE ${clauses.join(" AND ")}`;

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM rules r ${clause}`);
  const totalResult = await countStmt.bind(...params).first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / RULE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * RULE_PAGE_SIZE;

  const listStmt = db.prepare(
    `SELECT r.id, r.kind, r.title, r.explanation, r.pattern, r.points, r.notes, r.created_at,
            (SELECT COUNT(*) FROM rule_examples re WHERE re.rule_id = r.id) AS example_count
     FROM rules r ${clause}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ? OFFSET ?`
  );
  const { results } = await listStmt
    .bind(...params, RULE_PAGE_SIZE, offset)
    .all<{
      id: number;
      kind: RuleKind;
      title: string;
      explanation: string;
      pattern: string | null;
      points: string | null;
      notes: string | null;
      created_at: number;
      example_count: number;
    }>();

  const rules = results ?? [];
  const tagMap = await loadTagsForRules(db, rules.map((r) => r.id));

  return {
    items: rules.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      explanation: row.explanation,
      points: parseRulePoints(row.points, row.pattern),
      createdAt: row.created_at,
      exampleCount: row.example_count,
      tags: tagMap.get(row.id) ?? [],
      notes: row.notes,
    })),
    page: safePage,
    pageSize: RULE_PAGE_SIZE,
    total,
    pages,
  };
}

export async function getRule(ownerId: string, id: number): Promise<RuleDetail | null> {
  const db = getDb();
  const row = await db
    .prepare(
      "SELECT id, kind, title, explanation, pattern, points, notes, created_at FROM rules WHERE id = ?1 AND owner_id = ?2"
    )
    .bind(id, ownerId)
    .first<{
      id: number;
      kind: RuleKind;
      title: string;
      explanation: string;
      pattern: string | null;
      points: string | null;
      notes: string | null;
      created_at: number;
    }>();
  if (!row) return null;

  const { results } = await db
    .prepare(
      `SELECT japanese, english, english_equivalent
         FROM rule_examples
        WHERE rule_id = ?1
        ORDER BY id ASC`
    )
    .bind(id)
    .all<{ japanese: string; english: string; english_equivalent: string | null }>();
  const tagMap = await loadTagsForRules(db, [id]);

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    explanation: row.explanation,
    points: parseRulePoints(row.points, row.pattern),
    createdAt: row.created_at,
    exampleCount: (results ?? []).length,
    examples: (results ?? []).map((row) => ({
      japanese: row.japanese,
      english: row.english,
      englishEquivalent: row.english_equivalent,
    })),
    tags: tagMap.get(id) ?? [],
    related: await loadRelatedRules(db, id),
    notes: row.notes,
  };
}

export interface RuleInput {
  kind: RuleKind;
  title: string;
  explanation: string;
  points: string[];
  examples: RuleExample[];
  tags: string[];
  /** Ids of the rules linked to this one. */
  relatedIds: number[];
  /** Free-text notes (null = none). */
  notes: string | null;
}

/** Every rule of the owner, as an option for the "related rules" picker. */
export async function listRuleOptions(ownerId: string): Promise<{ id: number; title: string }[]> {
  const db = getDb();
  const { results } = await db
    .prepare("SELECT id, title FROM rules WHERE owner_id = ?1 ORDER BY title ASC, id ASC")
    .bind(ownerId)
    .all<{ id: number; title: string }>();
  return results ?? [];
}

/** The rules linked to this one — never inferred, always curated. */
async function loadRelatedRules(db: D1Database, ruleId: number): Promise<RelatedRule[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.kind, r.title
       FROM rule_related rr
       JOIN rules r ON r.id = rr.related_rule_id
       WHERE rr.rule_id = ?1
       ORDER BY r.title ASC, r.id ASC`
    )
    .bind(ruleId)
    .all<{ id: number; kind: RuleKind; title: string }>();
  return results ?? [];
}

/** Replace this rule's related-rule links (self-links and unknown ids drop out). */
async function setRelatedRules(
  db: D1Database,
  ruleId: number,
  relatedIds: number[]
): Promise<void> {
  await db.prepare("DELETE FROM rule_related WHERE rule_id = ?1").bind(ruleId).run();

  const ids = [...new Set(relatedIds)].filter(
    (id) => Number.isInteger(id) && id > 0 && id !== ruleId
  );
  if (ids.length === 0) return;

  await db.batch(
    ids.map((id) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO rule_related (rule_id, related_rule_id)
           SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM rules WHERE id = ?2)`
        )
        .bind(ruleId, id)
    )
  );
}

export async function createRule(ownerId: string, input: RuleInput): Promise<number> {
  const db = getDb();
  const stored = serializeRulePoints(input.points);
  const result = await db
    .prepare(
      "INSERT INTO rules (kind, title, explanation, pattern, points, notes, created_by, owner_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    )
    .bind(
      input.kind,
      input.title,
      input.explanation,
      stored.pattern,
      stored.points,
      input.notes ?? null,
      ownerId,
      ownerId
    )
    .run();
  const ruleId = result.meta.last_row_id;

  if (input.examples.length > 0) {
    await db.batch(
      input.examples.map((e) =>
        db
          .prepare(
            "INSERT INTO rule_examples (rule_id, japanese, english, english_equivalent) VALUES (?1, ?2, ?3, ?4)"
          )
          .bind(ruleId, e.japanese, e.english, e.englishEquivalent ?? null)
      )
    );
  }
  await setRelatedRules(db, ruleId, input.relatedIds);
  await setRuleTags(db, ruleId, input.tags);
  invalidateTagLookups(ownerId);
  return ruleId;
}

export async function updateRule(ownerId: string, id: number, input: RuleInput): Promise<boolean> {
  const db = getDb();
  const stored = serializeRulePoints(input.points);
  const result = await db
    .prepare(
      "UPDATE rules SET kind = ?1, title = ?2, explanation = ?3, pattern = ?4, points = ?5, notes = ?6 WHERE id = ?7 AND owner_id = ?8"
    )
    .bind(
      input.kind,
      input.title,
      input.explanation,
      stored.pattern,
      stored.points,
      input.notes ?? null,
      id,
      ownerId
    )
    .run();
  if (result.meta.changes === 0) return false;

  await db.prepare("DELETE FROM rule_examples WHERE rule_id = ?1").bind(id).run();
  if (input.examples.length > 0) {
    await db.batch(
      input.examples.map((e) =>
        db
          .prepare(
            "INSERT INTO rule_examples (rule_id, japanese, english, english_equivalent) VALUES (?1, ?2, ?3, ?4)"
          )
          .bind(id, e.japanese, e.english, e.englishEquivalent ?? null)
      )
    );
  }
  await setRelatedRules(db, id, input.relatedIds);
  await setRuleTags(db, id, input.tags);
  invalidateTagLookups(ownerId);
  return true;
}

/** Delete a rule together with its examples and tag links (cascade). */
export async function deleteRule(ownerId: string, id: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .prepare("DELETE FROM rules WHERE id = ?1 AND owner_id = ?2")
    .bind(id, ownerId)
    .run();
  if (result.meta.changes > 0) invalidateTagLookups(ownerId);
  return result.meta.changes > 0;
}

/**
 * How many rules (grammar/forms cards) exist, optionally by rule kind and
 * optionally limited to an explicit set of ids (the user's starred rules).
 */
export async function countRules(
  ownerId: string,
  kind?: RuleKind | null,
  starredIds?: CardIdFilter,
  tags?: string[] | null,
  excludedTags?: string[] | null
): Promise<number> {
  const db = getDb();
  const params: (string | number)[] = [ownerId];
  const clauses: string[] = ["owner_id = ?"];
  if (kind) {
    clauses.push("kind = ?");
    params.push(kind);
  }
  const idClause = cardIdClause(starredIds, params);
  if (idClause) clauses.push(idClause);
  const tagClause = ruleTagClause(tags, excludedTags, params);
  if (tagClause) clauses.push(tagClause);
  const where = `WHERE ${clauses.join(" AND ")}`;
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM rules ${where}`)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The three rule counts the study builder needs — all, word rules, sentence
 * rules — from a single round-trip instead of three `countRules()` calls.
 */
export async function countRulesByKind(ownerId: string): Promise<{
  all: number;
  word: number;
  sentence: number;
}> {
  const db = getDb();
  const { results } = await db
    .prepare("SELECT kind, COUNT(*) AS n FROM rules WHERE owner_id = ?1 GROUP BY kind")
    .bind(ownerId)
    .all<{ kind: RuleKind; n: number }>();
  const counts = { all: 0, word: 0, sentence: 0 };
  for (const row of results ?? []) {
    counts[row.kind] = row.n;
    counts.all += row.n;
  }
  return counts;
}

/** A rule as the quiz builder's picker needs it — no explanation, no examples. */
export interface RuleChoice {
  id: number;
  kind: RuleKind;
  title: string;
  /**
   * The rule's ポイント lines, in display order (empty for a rule with none).
   *
   * The picker shows these under each title: a rule's title is a name like
   * "Polite ます-form", and which forms it actually covers is the thing a quiz
   * builder needs to see before deciding whether to include it. Carried here
   * rather than fetched per rule, so the picker stays a single query.
   */
  points: string[];
  /**
   * The rule's tag names.
   *
   * Carried here so the builder can hide rules that fall outside the tag
   * filter. The server applies the same filter when it draws the quiz, so
   * without this the picker would offer rules the quiz can never use — the
   * mismatch that makes a builder lie about what it is going to ask.
   */
  tags: string[];
}

/**
 * Every rule the owner has, as a minimal `{id, kind, title, points, tags}`.
 *
 * The builder's rule picker needs the whole list at once — to offer "all", to
 * count the selection, and to show which are ticked — so this deliberately
 * skips both the pagination and the per-rule hydration that `listRules` does.
 * Ordered like the rules list, so the picker reads the same way.
 */
export async function listRuleChoices(ownerId: string, limit = 500): Promise<RuleChoice[]> {
  const db = getDb();
  // The rows and their tags do not depend on each other, so they go out
  // together rather than as two sequential round-trips.
  const [rows, tagRows] = await Promise.all([
    db
      .prepare(
        // `pattern` comes along for the same reason `listRules` reads it: a rule
        // saved before `points` existed keeps its single point there, and
        // `parseRulePoints` is the one place that knows the fallback.
        "SELECT id, kind, title, pattern, points FROM rules WHERE owner_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2"
      )
      .bind(ownerId, limit)
      .all<{ id: number; kind: RuleKind; title: string; pattern: string | null; points: string | null }>(),
    db
      .prepare(
        `SELECT rt.rule_id AS rule_id, t.name AS name
         FROM rule_tags rt
         JOIN tags t ON t.id = rt.tag_id
         JOIN rules r ON r.id = rt.rule_id
         WHERE r.owner_id = ?1
         ORDER BY t.name ASC`
      )
      .bind(ownerId)
      .all<{ rule_id: number; name: string }>(),
  ]);

  const tagMap = new Map<number, string[]>();
  for (const row of tagRows.results ?? []) {
    const existing = tagMap.get(row.rule_id);
    if (existing) existing.push(row.name);
    else tagMap.set(row.rule_id, [row.name]);
  }

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    points: parseRulePoints(row.points, row.pattern),
    tags: tagMap.get(row.id) ?? [],
  }));
}

/** A random deck of rules (with their examples) for the forms study tab. */
export async function getRuleStudyDeck(
  ownerId: string,
  limit = 40,
  kind?: RuleKind | null,
  starredIds?: CardIdFilter,
  tags?: string[] | null,
  excludedTags?: string[] | null
): Promise<RuleDetail[]> {
  const db = getDb();
  const params: (string | number)[] = [ownerId];
  const clauses: string[] = ["owner_id = ?"];
  if (kind) {
    clauses.push("kind = ?");
    params.push(kind);
  }
  const idClause = cardIdClause(starredIds, params);
  if (idClause) clauses.push(idClause);
  const tagClause = ruleTagClause(tags, excludedTags, params);
  if (tagClause) clauses.push(tagClause);
  const where = `WHERE ${clauses.join(" AND ")}`;
  const { results } = await db
    .prepare(`SELECT id FROM rules ${where} ORDER BY RANDOM() LIMIT ?`)
    .bind(...params, limit)
    .all<{ id: number }>();

  const ids = (results ?? []).map((row) => row.id);
  const details = await Promise.all(ids.map((id) => getRule(ownerId, id)));
  return details.filter((detail): detail is RuleDetail => detail !== null);
}

/** A rule example sentence together with the rule it belongs to. */
export interface RuleExampleItem {
  id: number;
  japanese: string;
  /** English translation of the sentence. */
  english: string;
  /** English equivalent of the grammar shown (null = not written yet). */
  englishEquivalent: string | null;
  ruleId: number;
  ruleTitle: string;
  ruleKind: RuleKind;
}

const RULE_EXAMPLE_PAGE_SIZE = 20;

/** All rule/grammar example sentences of the owner — powers /rules/examples. */
export async function listRuleExamples(ownerId: string, page: number): Promise<Paginated<RuleExampleItem>> {
  const db = getDb();
  const totalResult = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM rule_examples re
       JOIN rules r ON r.id = re.rule_id
       WHERE r.owner_id = ?1`
    )
    .bind(ownerId)
    .first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / RULE_EXAMPLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * RULE_EXAMPLE_PAGE_SIZE;

  const { results } = await db
    .prepare(
      `SELECT re.id, re.japanese, re.english, re.english_equivalent, re.rule_id,
              r.title AS rule_title, r.kind AS rule_kind
       FROM rule_examples re
       JOIN rules r ON r.id = re.rule_id
       WHERE r.owner_id = ?1
       ORDER BY r.created_at DESC, r.id DESC, re.id ASC
       LIMIT ?2 OFFSET ?3`
    )
    .bind(ownerId, RULE_EXAMPLE_PAGE_SIZE, offset)
    .all<{
      id: number;
      japanese: string;
      english: string;
      english_equivalent: string | null;
      rule_id: number;
      rule_title: string;
      rule_kind: RuleKind;
    }>();

  return {
    items: (results ?? []).map((row) => ({
      id: row.id,
      japanese: row.japanese,
      english: row.english,
      englishEquivalent: row.english_equivalent,
      ruleId: row.rule_id,
      ruleTitle: row.rule_title,
      ruleKind: row.rule_kind,
    })),
    page: safePage,
    pageSize: RULE_EXAMPLE_PAGE_SIZE,
    total,
    pages,
  };
}
