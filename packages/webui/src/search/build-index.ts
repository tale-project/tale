import MiniSearch, { type AsPlainObject } from 'minisearch';

export interface SearchDoc {
  id: string;
  /** Page title from frontmatter. */
  title: string;
  /** Concatenated h2/h3 headings — boosted at search time. */
  headings: string;
  /** Plain-text body (markdown stripped). Truncated for the stored copy used
   *  to render result snippets — full body is still indexed for retrieval. */
  body: string;
  /** Absolute URL on the destination site. */
  url: string;
  /** Section key — top-level slug segment (e.g. "platform", "cloud"). */
  section?: string;
  /** Locale tag — used to scope/load the right per-locale index. */
  locale?: string;
}

export interface SerializedIndex {
  index: AsPlainObject;
  docs: SearchDoc[];
}

const FIELDS = ['title', 'headings', 'body'] as const;
const STORE_FIELDS = ['title', 'url', 'section', 'locale', 'body'] as const;

/** Maximum number of body characters retained in the stored copy. The full
 *  body is indexed for retrieval — this only caps the in-memory text used
 *  to render snippets so per-locale JSON files stay slim. */
const STORED_BODY_LIMIT = 1500;

export function createMiniSearch(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: [...FIELDS],
    storeFields: [...STORE_FIELDS],
    searchOptions: {
      boost: { title: 4, headings: 2 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'AND',
    },
  });
}

export function buildSearchIndex(docs: readonly SearchDoc[]): SerializedIndex {
  const ms = createMiniSearch();
  const trimmed = docs.map((doc) => ({
    ...doc,
    body: truncateBody(doc.body),
  }));
  ms.addAll(trimmed);
  return { index: ms.toJSON(), docs: trimmed };
}

/** Strip markdown to plain text. Keeps inline links' visible text. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^>\s*/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateBody(body: string): string {
  if (body.length <= STORED_BODY_LIMIT) return body;
  // Snap to a word boundary to avoid cutting mid-word.
  const sliced = body.slice(0, STORED_BODY_LIMIT);
  const lastSpace = sliced.lastIndexOf(' ');
  return lastSpace > STORED_BODY_LIMIT * 0.8
    ? sliced.slice(0, lastSpace)
    : sliced;
}
