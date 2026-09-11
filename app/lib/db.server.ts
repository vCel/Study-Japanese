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
}

/** Word as exposed to the UI. */
export interface WordSummary {
  id: number;
  word: string;
  kana: string;
  pos: string | null;
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
}

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

function getDb(): D1Database {
  return env.DB;
}

export async function getStats(): Promise<Stats> {
  const db = getDb();
  const [words, examples, lists] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM words").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM examples").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM word_lists").first<{ n: number }>(),
  ]);
  return {
    words: words?.n ?? 0,
    examples: examples?.n ?? 0,
    lists: lists?.n ?? 0,
  };
}

export async function listWords(
  search: string | null,
  page: number,
  pos?: string | null,
  excludePos?: string | null
): Promise<Paginated<WordSummary>> {
  const db = getDb();
  const params: (string | number)[] = [];
  let clause = "";
  if (search) {
    const like = `%${search}%`;
    params.push(like, like);
    clause = "WHERE (w.word LIKE ? OR w.kana LIKE ?)";
  }
  if (pos) {
    clause += clause ? " AND w.pos = ?" : "WHERE w.pos = ?";
    params.push(pos);
  }
  if (excludePos) {
    clause += clause
      ? " AND (w.pos IS NULL OR w.pos <> ?)"
      : "WHERE (w.pos IS NULL OR w.pos <> ?)";
    params.push(excludePos);
  }

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM words w ${clause}`);
  const totalResult = await countStmt.bind(...params).first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const listStmt = db.prepare(
    `SELECT w.id, w.word, w.kana, w.created_at, w.pos,
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

export async function getWord(id: number): Promise<WordDetail | null> {
  const db = getDb();
  const row = await db
    .prepare(
      `SELECT w.id, w.word, w.kana, w.created_by, w.created_at, w.pos, w.list_id,
              l.title AS list_title, l.created_by AS list_author
       FROM words w
       LEFT JOIN word_lists l ON l.id = w.list_id
       WHERE w.id = ?1`
    )
    .bind(id)
    .first<
      WordRow & { list_id: number | null; list_title: string | null; list_author: string | null }
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
    meaning: meanings.results?.[0]?.meaning ?? null,
    meanings: (meanings.results ?? []).map((m) => m.meaning),
    examples: examples.results ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    listId: row.list_id,
    listTitle: row.list_title,
    listAuthor: row.list_author,
  };
}

export async function listExamples(page: number): Promise<Paginated<ExampleItem>> {
  const db = getDb();
  const PAGE = 20;

  const totalResult = await db.prepare("SELECT COUNT(*) AS n FROM examples").first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * PAGE;

  const { results } = await db
    .prepare(
      `SELECT e.id, e.japanese, e.translation, e.word_id, w.word, w.kana
       FROM examples e
       JOIN words w ON w.id = e.word_id
       ORDER BY e.id ASC
       LIMIT ?1 OFFSET ?2`
    )
    .bind(PAGE, offset)
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
export async function listAllLists(): Promise<WordListSummary[]> {
  const db = getDb();
  const { results } = await db
    .prepare(
      `SELECT wl.id, wl.title, wl.description, wl.created_by, wl.created_at,
              (SELECT COUNT(*) FROM words w WHERE w.list_id = wl.id) AS word_count
       FROM word_lists wl
       ORDER BY wl.created_at DESC, wl.id DESC`
    )
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

/** Ids of lists carrying ANY of the given tag names. */
export async function listIdsByTags(tagNames: string[]): Promise<number[]> {
  if (tagNames.length === 0) return [];
  const db = getDb();
  const placeholders = tagNames.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT DISTINCT wlt.list_id AS id
       FROM word_list_tags wlt
       JOIN tags t ON t.id = wlt.tag_id
       WHERE t.name IN (${placeholders})`
    )
    .bind(...tagNames)
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

/** Ids of every word list. */
export async function listAllListIds(): Promise<number[]> {
  const db = getDb();
  const { results } = await db.prepare("SELECT id FROM word_lists").all<{ id: number }>();
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
 */
export async function listStudyLists(): Promise<StudyLibrary> {
  const db = getDb();
  const lists = await listAllLists();

  const { results } = await db
    .prepare(
      `SELECT list_id AS id,
              SUM(CASE WHEN pos = 'phrase' THEN 1 ELSE 0 END) AS phrases,
              SUM(CASE WHEN pos IS NULL OR pos <> 'phrase' THEN 1 ELSE 0 END) AS words
       FROM words
       WHERE list_id IS NOT NULL
       GROUP BY list_id`
    )
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

/** How many cards of the given kind exist across the given lists. */
export async function countWordsInLists(
  listIds: number[],
  pos?: string | null,
  kind: StudyListKind = "words"
): Promise<number> {
  if (listIds.length === 0) return 0;
  const db = getDb();
  const placeholders = listIds.map(() => "?").join(", ");
  const params: (string | number)[] = [...listIds];
  let clause = studyKindClause(kind);
  if (pos) {
    clause += " AND pos = ?";
    params.push(pos);
  }
  // Parameters are the list ids (for the IN clause) followed by the optional
  // part-of-speech filter.
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM words WHERE list_id IN (${placeholders}) AND ${clause}`)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
export async function getStudyDeck(
  listIds: number[],
  limit = 40,
  pos?: string | null,
  kind: StudyListKind = "words"
): Promise<WordDetail[]> {
  const db = getDb();
  if (listIds.length === 0) return [];

  const placeholders = listIds.map(() => "?").join(", ");
  const params: (string | number)[] = [...listIds];
  let clause = studyKindClause(kind);
  if (pos) {
    clause += " AND pos = ?";
    params.push(pos);
  }
  const { results } = await db
    .prepare(
      `SELECT id FROM words WHERE list_id IN (${placeholders}) AND ${clause} ORDER BY RANDOM() LIMIT ?`
    )
    .bind(...params, limit)
    .all<{ id: number }>();
  const ids = (results ?? []).map((r) => r.id);
  const details = await Promise.all(ids.map((id) => getWord(id)));
  return details.filter((d): d is WordDetail => d !== null);
}

export interface InsertResult {
  wordsInserted: number;
  meaningsInserted: number;
  examplesInserted: number;
}

/** Create a word list and attach (creating if needed) the given tag names. */
export async function createWordList(
  title: string,
  description: string | null,
  createdBy: string | null,
  tags: string[]
): Promise<number> {
  const db = getDb();
  const listResult = await db
    .prepare("INSERT INTO word_lists (title, description, created_by) VALUES (?1, ?2, ?3)")
    .bind(title, description, createdBy)
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
  page: number,
  tag?: string | null,
  pos?: string | null,
  excludePos?: string | null
): Promise<Paginated<WordListSummary>> {
  const db = getDb();
  const params: (string | number)[] = [];
  let clause = "";
  if (tag) {
    params.push(`%${tag.toLowerCase()}%`);
    clause =
      "WHERE EXISTS (SELECT 1 FROM word_list_tags wlt JOIN tags t ON t.id = wlt.tag_id WHERE wlt.list_id = wl.id AND t.name LIKE ?)";
  }
  if (pos) {
    clause += clause
      ? " AND EXISTS (SELECT 1 FROM words w WHERE w.list_id = wl.id AND w.pos = ?)"
      : "WHERE EXISTS (SELECT 1 FROM words w WHERE w.list_id = wl.id AND w.pos = ?)";
    params.push(pos);
  }
  if (excludePos) {
    clause += clause
      ? " AND NOT EXISTS (SELECT 1 FROM words w WHERE w.list_id = wl.id AND w.pos = ?)"
      : "WHERE NOT EXISTS (SELECT 1 FROM words w WHERE w.list_id = wl.id AND w.pos = ?)";
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

/** All tags with how many word lists use them — powers the tag search UI. */
export async function listAllTags(): Promise<TagInfo[]> {
  const db = getDb();
  const { results } = await db
    .prepare(
      `SELECT t.name, COUNT(wlt.list_id) AS list_count
       FROM tags t
       JOIN word_list_tags wlt ON wlt.tag_id = t.id
       GROUP BY t.id
       ORDER BY list_count DESC, t.name ASC`
    )
    .all<{ name: string; list_count: number }>();
  return (results ?? []).map((row) => ({ name: row.name, listCount: row.list_count }));
}

export async function getWordList(id: number): Promise<WordListDetail | null> {
  const db = getDb();
  const list = await db
    .prepare("SELECT id, title, description, created_by, created_at FROM word_lists WHERE id = ?1")
    .bind(id)
    .first<{ id: number; title: string; description: string | null; created_by: string | null; created_at: number }>();
  if (!list) return null;

  const { results } = await db
    .prepare(
      `SELECT w.id, w.word, w.kana, w.created_at, w.pos,
              (SELECT m.meaning FROM meanings m WHERE m.word_id = w.id LIMIT 1) AS meaning,
              w.list_id, l.title AS list_title
       FROM words w
       LEFT JOIN word_lists l ON l.id = w.list_id
       WHERE w.list_id = ?1
       ORDER BY w.id ASC`
    )
    .bind(id)
    .all<WordRow & { meaning: string | null; list_id: number | null; list_title: string | null }>();

  const tagMap = await loadTagsForLists(db, [id]);

  return {
    id: list.id,
    title: list.title,
    description: list.description,
    createdAt: list.created_at,
    createdBy: list.created_by,
    wordCount: (results ?? []).length,
    tags: tagMap.get(id) ?? [],
    words: (results ?? []).map((row) => ({
      id: row.id,
      word: row.word,
      kana: row.kana,
      pos: row.pos,
      meaning: row.meaning,
      createdAt: row.created_at,
      listId: row.list_id,
      listTitle: row.list_title,
    })),
  };
}

export async function insertVocabEntries(
  entries: VocabEntry[],
  createdBy: string | null,
  listId: number | null
): Promise<InsertResult> {
  const db = getDb();
  const insertWord = db.prepare(
    "INSERT INTO words (word, kana, pos, created_by, list_id) VALUES (?1, ?2, ?3, ?4, ?5)"
  );
  const insertMeaning = db.prepare("INSERT INTO meanings (word_id, meaning) VALUES (?1, ?2)");
  const insertExample = db.prepare("INSERT INTO examples (word_id, japanese, translation) VALUES (?1, ?2, ?3)");

  // Two-phase: insert words first (to learn their ids), then children.
  const wordResults = await db.batch(
    entries.map((entry) => insertWord.bind(entry.word, entry.kana, entry.pos, createdBy, listId))
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

/** Returns the Convex user id that owns the list containing this word, plus the word's creator. */
export async function getWordAuthorContext(
  wordId: number
): Promise<{ createdBy: string | null; listAuthor: string | null; listId: number | null } | null> {
  const db = getDb();
  return (
    (await db
      .prepare(
        `SELECT w.created_by, w.list_id, l.created_by AS list_author
         FROM words w
         LEFT JOIN word_lists l ON l.id = w.list_id
         WHERE w.id = ?1`
      )
      .bind(wordId)
      .first<{ createdBy: string | null; listId: number | null; listAuthor: string | null }>()) ??
    null
  );
}

/** A user may edit a word if they created it, authored its list, or are an admin. */
export async function canEditWord(
  wordId: number,
  userId: string,
  isAdmin = false
): Promise<boolean> {
  if (isAdmin) return true;
  const ctx = await getWordAuthorContext(wordId);
  if (!ctx) return false;
  return ctx.createdBy === userId || (ctx.listAuthor !== null && ctx.listAuthor === userId);
}

/** Update a word list's metadata. Tags are replaced as a whole set. */
export async function updateWordList(
  listId: number,
  title: string,
  description: string | null,
  tags: string[]
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .prepare("UPDATE word_lists SET title = ?1, description = ?2 WHERE id = ?3")
    .bind(title, description, listId)
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
  return true;
}

/**
 * Delete a word list. Its words are kept but detached
 * (`words.list_id REFERENCES word_lists(id) ON DELETE SET NULL`), and the
 * word_list_tags join rows cascade away.
 */
export async function deleteWordList(listId: number): Promise<boolean> {
  const db = getDb();
  const result = await db.prepare("DELETE FROM word_lists WHERE id = ?1").bind(listId).run();
  return result.meta.changes > 0;
}

export interface WordUpdateInput {
  word: string;
  kana: string;
  pos: string | null;
  meanings: string[];
  examples: { japanese: string; translation: string | null }[];
}

/** Update a word's core fields and replace its meanings/examples wholesale. */
export async function updateWord(wordId: number, data: WordUpdateInput): Promise<boolean> {
  const db = getDb();
  const result = await db
    .prepare("UPDATE words SET word = ?1, kana = ?2, pos = ?3 WHERE id = ?4")
    .bind(data.word, data.kana, data.pos, wordId)
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
export async function deleteWord(wordId: number): Promise<boolean> {
  const db = getDb();
  const result = await db.prepare("DELETE FROM words WHERE id = ?1").bind(wordId).run();
  return result.meta.changes > 0;
}

// ---------------------------------------------------------------------------
// Rules (grammar): word rules & sentence rules — admin-managed.
// ---------------------------------------------------------------------------

export type RuleKind = "word" | "sentence";

export interface RuleExample {
  japanese: string;
  english: string;
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
}

/** A rule an admin linked to another one. */
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

/** Tags actually used by rules — powers the rules page tag filter. */
export async function listAllRuleTags(): Promise<TagInfo[]> {
  const db = getDb();
  const { results } = await db
    .prepare(
      `SELECT t.name, COUNT(rt.rule_id) AS list_count
       FROM tags t
       JOIN rule_tags rt ON rt.tag_id = t.id
       GROUP BY t.id
       ORDER BY list_count DESC, t.name ASC`
    )
    .all<{ name: string; list_count: number }>();
  return (results ?? []).map((row) => ({ name: row.name, listCount: row.list_count }));
}

export async function listRules(
  kind: RuleKind | null,
  page: number,
  search: string | null = null,
  tag: string | null = null
): Promise<Paginated<RuleSummary>> {
  const db = getDb();
  const params: (string | number)[] = [];
  const clauses: string[] = [];

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
  const clause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM rules r ${clause}`);
  const totalResult = await countStmt.bind(...params).first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / RULE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * RULE_PAGE_SIZE;

  const listStmt = db.prepare(
    `SELECT r.id, r.kind, r.title, r.explanation, r.pattern, r.points, r.created_at,
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
    })),
    page: safePage,
    pageSize: RULE_PAGE_SIZE,
    total,
    pages,
  };
}

export async function getRule(id: number): Promise<RuleDetail | null> {
  const db = getDb();
  const row = await db
    .prepare(
      "SELECT id, kind, title, explanation, pattern, points, created_at FROM rules WHERE id = ?1"
    )
    .bind(id)
    .first<{
      id: number;
      kind: RuleKind;
      title: string;
      explanation: string;
      pattern: string | null;
      points: string | null;
      created_at: number;
    }>();
  if (!row) return null;

  const { results } = await db
    .prepare("SELECT japanese, english FROM rule_examples WHERE rule_id = ?1 ORDER BY id ASC")
    .bind(id)
    .all<RuleExample>();
  const tagMap = await loadTagsForRules(db, [id]);

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    explanation: row.explanation,
    points: parseRulePoints(row.points, row.pattern),
    createdAt: row.created_at,
    exampleCount: (results ?? []).length,
    examples: results ?? [],
    tags: tagMap.get(id) ?? [],
    related: await loadRelatedRules(db, id),
  };
}

export interface RuleInput {
  kind: RuleKind;
  title: string;
  explanation: string;
  points: string[];
  examples: RuleExample[];
  tags: string[];
  /** Ids of the rules an admin linked to this one. */
  relatedIds: number[];
}

/** Every rule, as an option for the "related rules" picker on the rule form. */
export async function listRuleOptions(): Promise<{ id: number; title: string }[]> {
  const db = getDb();
  const { results } = await db
    .prepare("SELECT id, title FROM rules ORDER BY title ASC, id ASC")
    .all<{ id: number; title: string }>();
  return results ?? [];
}

/** The rules an admin linked to this one — never inferred, always curated. */
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

export async function createRule(input: RuleInput, createdBy: string): Promise<number> {
  const db = getDb();
  const stored = serializeRulePoints(input.points);
  const result = await db
    .prepare(
      "INSERT INTO rules (kind, title, explanation, pattern, points, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    )
    .bind(input.kind, input.title, input.explanation, stored.pattern, stored.points, createdBy)
    .run();
  const ruleId = result.meta.last_row_id;

  if (input.examples.length > 0) {
    await db.batch(
      input.examples.map((e) =>
        db
          .prepare("INSERT INTO rule_examples (rule_id, japanese, english) VALUES (?1, ?2, ?3)")
          .bind(ruleId, e.japanese, e.english)
      )
    );
  }
  await setRelatedRules(db, ruleId, input.relatedIds);
  await setRuleTags(db, ruleId, input.tags);
  return ruleId;
}

export async function updateRule(id: number, input: RuleInput): Promise<boolean> {
  const db = getDb();
  const stored = serializeRulePoints(input.points);
  const result = await db
    .prepare(
      "UPDATE rules SET kind = ?1, title = ?2, explanation = ?3, pattern = ?4, points = ?5 WHERE id = ?6"
    )
    .bind(input.kind, input.title, input.explanation, stored.pattern, stored.points, id)
    .run();
  if (result.meta.changes === 0) return false;

  await db.prepare("DELETE FROM rule_examples WHERE rule_id = ?1").bind(id).run();
  if (input.examples.length > 0) {
    await db.batch(
      input.examples.map((e) =>
        db
          .prepare("INSERT INTO rule_examples (rule_id, japanese, english) VALUES (?1, ?2, ?3)")
          .bind(id, e.japanese, e.english)
      )
    );
  }
  await setRelatedRules(db, id, input.relatedIds);
  await setRuleTags(db, id, input.tags);
  return true;
}

/** Delete a rule together with its examples and tag links (cascade). */
export async function deleteRule(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db.prepare("DELETE FROM rules WHERE id = ?1").bind(id).run();
  return result.meta.changes > 0;
}

/** How many rules (grammar/forms cards) exist, optionally by rule kind. */
export async function countRules(kind?: RuleKind | null): Promise<number> {
  const db = getDb();
  const row = kind
    ? await db.prepare("SELECT COUNT(*) AS n FROM rules WHERE kind = ?1").bind(kind).first<{ n: number }>()
    : await db.prepare("SELECT COUNT(*) AS n FROM rules").first<{ n: number }>();
  return row?.n ?? 0;
}

/** A random deck of rules (with their examples) for the forms study tab. */
export async function getRuleStudyDeck(
  limit = 40,
  kind?: RuleKind | null
): Promise<RuleDetail[]> {
  const db = getDb();
  const { results } = kind
    ? await db
        .prepare("SELECT id FROM rules WHERE kind = ?1 ORDER BY RANDOM() LIMIT ?2")
        .bind(kind, limit)
        .all<{ id: number }>()
    : await db
        .prepare("SELECT id FROM rules ORDER BY RANDOM() LIMIT ?1")
        .bind(limit)
        .all<{ id: number }>();

  const ids = (results ?? []).map((row) => row.id);
  const details = await Promise.all(ids.map((id) => getRule(id)));
  return details.filter((detail): detail is RuleDetail => detail !== null);
}

/** A rule example sentence together with the rule it belongs to. */
export interface RuleExampleItem {
  id: number;
  japanese: string;
  english: string;
  ruleId: number;
  ruleTitle: string;
  ruleKind: RuleKind;
}

const RULE_EXAMPLE_PAGE_SIZE = 20;

/** All rule/grammar example sentences — powers the dedicated /rules/examples page. */
export async function listRuleExamples(page: number): Promise<Paginated<RuleExampleItem>> {
  const db = getDb();
  const totalResult = await db
    .prepare("SELECT COUNT(*) AS n FROM rule_examples")
    .first<{ n: number }>();
  const total = totalResult?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / RULE_EXAMPLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * RULE_EXAMPLE_PAGE_SIZE;

  const { results } = await db
    .prepare(
      `SELECT re.id, re.japanese, re.english, re.rule_id,
              r.title AS rule_title, r.kind AS rule_kind
       FROM rule_examples re
       JOIN rules r ON r.id = re.rule_id
       ORDER BY r.created_at DESC, r.id DESC, re.id ASC
       LIMIT ?1 OFFSET ?2`
    )
    .bind(RULE_EXAMPLE_PAGE_SIZE, offset)
    .all<{
      id: number;
      japanese: string;
      english: string;
      rule_id: number;
      rule_title: string;
      rule_kind: RuleKind;
    }>();

  return {
    items: (results ?? []).map((row) => ({
      id: row.id,
      japanese: row.japanese,
      english: row.english,
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