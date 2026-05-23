import MiniSearch, { type AsPlainObject, type SearchOptions } from 'minisearch';

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
  /** Optional document-level ranking weight (frontmatter `weight`). */
  weight?: number;
}

export interface SerializedIndex {
  index: AsPlainObject;
  docs: SearchDoc[];
}

const FIELDS = ['title', 'headings', 'body'] as const;
const STORE_FIELDS = [
  'title',
  'url',
  'section',
  'locale',
  'body',
  'weight',
] as const;

/** Maximum number of body characters retained in the stored copy. The full
 *  body is indexed for retrieval — this only caps the in-memory text used
 *  to render snippets so per-locale JSON files stay slim. */
const STORED_BODY_LIMIT = 1500;

/** Per-token tuning lifted out of `createMiniSearch` so the runtime client and
 *  the build-time index agree on matching behaviour. Override via spread when
 *  calling `MiniSearch.search(query, { ...DEFAULT_SEARCH_OPTIONS, combineWith }).` */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  boost: { title: 4, headings: 2 },
  // Skip prefix expansion on short tokens — "cli" should not bloom into
  // "client", "cling", "clip", etc. Three letters is the cutoff at which
  // prefix matching starts adding more signal than noise.
  prefix: (term: string) => term.length >= 4,
  // Skip fuzzy on short tokens entirely; for ≥5-char tokens allow ~1 edit
  // per 5 characters (`0.2` is the ratio MiniSearch interprets as edit
  // distance). Without `maxFuzzy: 2` a 10-char token would otherwise admit
  // 2-edit neighbours, which is too lossy for technical docs.
  fuzzy: (term: string) => (term.length >= 5 ? 0.2 : 0),
  maxFuzzy: 2,
  // Down-weight prefix and fuzzy hits relative to exact matches. Default
  // weights are 1/0.9 — too generous for synonyms.
  weights: { prefix: 0.6, fuzzy: 0.4 },
  // Per-doc ranking prior. Frontmatter `weight` lets curated landing pages
  // outrank deep reference pages for the same score.
  // oxlint-disable-next-line typescript/no-explicit-any -- MiniSearch types stored fields as `any`.
  boostDocument: (_id, _term, stored: any) => {
    const w = stored?.weight;
    return typeof w === 'number' && w > 0 ? w : 1;
  },
};

export function createMiniSearch(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: [...FIELDS],
    storeFields: [...STORE_FIELDS],
    searchOptions: DEFAULT_SEARCH_OPTIONS,
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
  return (
    md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^>\s*/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      // Heading-anchor extensions like `### Title {#anchor}` — drop the
      // `{#anchor}` syntax so it doesn't bleed into search snippets.
      .replace(/\s*\{#[^}]+\}/g, '')
      // Markdown table separator rows (`| --- | --- |`) and the table pipes
      // themselves — keep the cell text but drop the visual delimiter so a
      // snippet reads like prose instead of `| col1 | col2 |`.
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
