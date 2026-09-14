import MiniSearch, { type AsPlainObject, type SearchOptions } from 'minisearch';

/**
 * The static search index. Single-locale twin of the docs site's
 * `app/features/search/build-index.ts` — same field weights and tuning, minus
 * the per-locale index split this site does not need.
 */

export interface SearchDoc {
  id: string;
  /** Page title from frontmatter. */
  title: string;
  /** Concatenated h2/h3 headings — boosted at search time. */
  headings: string;
  /** Plain-text body (markdown stripped). Truncated for the stored copy used
   *  to render result snippets; the full body is still indexed. */
  body: string;
  /** Site-relative URL of the page. */
  url: string;
  /** Section key — the top-level slug segment (e.g. `components`). */
  section?: string;
}

export interface SerializedIndex {
  index: AsPlainObject;
  docs: SearchDoc[];
}

export const SEARCH_FIELDS = ['title', 'headings', 'body'] as const;
export const SEARCH_STORE_FIELDS = ['title', 'url', 'section', 'body'] as const;

/** Maximum number of body characters retained in the stored copy. */
const STORED_BODY_LIMIT = 1500;

/** Per-token tuning shared by the build-time index and the runtime client. */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  boost: { title: 4, headings: 2 },
  // Skip prefix expansion on short tokens — "tab" should not bloom into
  // "table", "tabindex", … Four letters is where prefix matching starts
  // adding more signal than noise.
  prefix: (term: string) => term.length >= 4,
  fuzzy: (term: string) => (term.length >= 5 ? 0.2 : 0),
  maxFuzzy: 2,
  weights: { prefix: 0.6, fuzzy: 0.4 },
};

export function createMiniSearch(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: [...SEARCH_FIELDS],
    storeFields: [...SEARCH_STORE_FIELDS],
    searchOptions: DEFAULT_SEARCH_OPTIONS,
  });
}

export function buildSearchIndex(docs: readonly SearchDoc[]): SerializedIndex {
  const ms = createMiniSearch();
  const trimmed = docs.map((doc) => ({ ...doc, body: truncateBody(doc.body) }));
  ms.addAll(trimmed);
  return { index: ms.toJSON(), docs: trimmed };
}

/** Strip markdown to plain text. Keeps inline links' visible text. */
export function stripMarkdown(md: string): string {
  return (
    md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^>\s*/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\s*\{#[^}]+\}/g, '')
      // Markdown table separator rows and the pipes themselves — keep the cell
      // text but drop the delimiters so a snippet reads like prose.
      .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, ' ')
      .replace(/\|/g, ' ')
      .replace(/[*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
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
