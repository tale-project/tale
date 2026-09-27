import MiniSearch, { type AsPlainObject, type SearchOptions } from 'minisearch';

/**
 * The static search index a documentation site ships as a JSON asset: built
 * once at build time from the site's markdown, fetched and rehydrated by
 * `client.ts` when a reader first opens the palette. The build and the
 * runtime share the field lists and the tuning below, so matching behaves the
 * same on both sides.
 */

export interface SearchDoc {
  id: string;
  /** Page title from frontmatter. */
  title: string;
  /** Concatenated h2/h3 headings — boosted at search time. */
  headings: string;
  /** Plain-text body (markdown stripped). Indexed in full for retrieval;
   *  never stored — the stored copy is the `snippet` the build cuts from it
   *  (see `StoredSearchDoc`). */
  body: string;
  /** Site-relative URL of the page. */
  url: string;
  /** Section key — top-level slug segment (e.g. "platform", "cloud"). */
  section?: string;
  /** Locale tag, for a site that ships one index per locale. */
  locale?: string;
  /** Optional document-level ranking weight (frontmatter `weight`). */
  weight?: number;
}

/** What the index stores per page: everything but the body, plus the
 *  snippet cut from its head. The full body lives only in the inverted
 *  index. */
export type StoredSearchDoc = Omit<SearchDoc, 'body' | 'headings'> & {
  /** The first `STORED_SNIPPET_LIMIT` characters of the stripped body,
   *  snapped to a word — what a result row renders and centres on. */
  snippet: string;
};

export interface SerializedIndex {
  index: AsPlainObject;
  docs: StoredSearchDoc[];
}

export const SEARCH_FIELDS = ['title', 'headings', 'body'] as const;
export const SEARCH_STORE_FIELDS = [
  'title',
  'url',
  'section',
  'locale',
  'snippet',
  'weight',
] as const;

/** Maximum number of body characters kept as the stored snippet. The FULL
 *  body is indexed for retrieval (an error code on the last screen of the
 *  API reference is still a hit); only the text a result row renders is
 *  capped, so the index JSON stays slim. */
export const STORED_SNIPPET_LIMIT = 1500;

/** Per-token tuning lifted out of `createMiniSearch` so the runtime client and
 *  the build-time index agree on matching behaviour. Override via spread when
 *  calling `MiniSearch.search(query, { ...DEFAULT_SEARCH_OPTIONS, combineWith }).` */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  boost: { title: 4, headings: 2 },
  // Skip prefix expansion on short tokens — "cli" should not bloom into
  // "client", "cling", "clip", etc. Four letters is the cutoff at which
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
    fields: [...SEARCH_FIELDS],
    storeFields: [...SEARCH_STORE_FIELDS],
    searchOptions: DEFAULT_SEARCH_OPTIONS,
  });
}

/** Index every page's full body; store only its snippet. `body` is a
 *  search field and `snippet` a store field, so MiniSearch tokenises the
 *  whole text and serialises only the head of it. */
export function buildSearchIndex(docs: readonly SearchDoc[]): SerializedIndex {
  const ms = createMiniSearch();
  const stored: StoredSearchDoc[] = [];
  ms.addAll(
    docs.map((doc) => {
      const { body, headings: _headings, ...rest } = doc;
      const entry: StoredSearchDoc = { ...rest, snippet: cutSnippet(body) };
      stored.push(entry);
      return { ...doc, snippet: entry.snippet };
    }),
  );
  return { index: ms.toJSON(), docs: stored };
}

/** Strip markdown to plain text. Keeps inline links' visible text and the
 *  text of inline code — an error code, a header name or an environment
 *  variable is exactly what a developer searches for. Emphasis markers go
 *  only where they delimit a word (`*bold*`, `_em_`, `~del~`); an underscore
 *  inside an identifier (`ORG_SLUG_REQUIRED`) is part of the name. */
export function stripMarkdown(md: string): string {
  return (
    md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, ' $1 ')
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
      // List bullets, then emphasis delimiters: an opening run after a
      // space or bracket, a closing run before space or punctuation.
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/(^|[\s([{])[*_~]{1,3}(?=\S)/g, '$1')
      .replace(/(?<=\S)[*_~]{1,3}(?=[\s)\]}.,;:!?]|$)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function cutSnippet(body: string): string {
  if (body.length <= STORED_SNIPPET_LIMIT) return body;
  // Snap to a word boundary to avoid cutting mid-word.
  const sliced = body.slice(0, STORED_SNIPPET_LIMIT);
  const lastSpace = sliced.lastIndexOf(' ');
  return lastSpace > STORED_SNIPPET_LIMIT * 0.8
    ? sliced.slice(0, lastSpace)
    : sliced;
}
