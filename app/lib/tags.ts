const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;

/**
 * Normalize tags from either a comma-separated form field or an array of
 * strings (bulk JSON imports). Lowercased, trimmed, de-duplicated and capped.
 */
export function parseTags(raw: FormDataEntryValue | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];

  const seen = new Set<string>();
  for (const part of parts) {
    const tag = part.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (tag.length > 0 && seen.size < MAX_TAGS) seen.add(tag);
  }
  return [...seen];
}
