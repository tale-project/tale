export interface SearchResult {
  /** Document id (locale-prefixed slug). */
  id: string;
  /** Page title from frontmatter. */
  title: string;
  /** Absolute URL on the destination site. */
  url: string;
  /** Section key — top-level slug segment (e.g. "platform", "cloud"). */
  section?: string;
  /** Locale tag (e.g. "en", "de", "fr"). */
  locale?: string;
  /** Stripped body — used to render snippets and count secondary matches. */
  body?: string;
  /** Final score after rerank (coverage + proximity + body-only penalty). */
  score: number;
  /** Index terms that matched — `["configuration"]` for query `"config"`.
   *  Drives highlight + snippet centring so the marks show *what was found*. */
  matchedTerms: string[];
  /** User tokens that produced matches — subset of the typed query. Useful
   *  for centring snippets on what the user actually typed. */
  queryTerms: string[];
  /** Map of matched index term → fields it hit in (`title`, `headings`,
   *  `body`). Drives field-aware ranking and the result-row icon. */
  match: Record<string, string[]>;
}

export interface RecentSearch {
  /** Free-text query the user typed. */
  query: string;
  /** Optional URL the user navigated to from this query. */
  url?: string;
  /** Optional title of the result the user opened. */
  title?: string;
  /** Epoch milliseconds — used for ordering and TTL. */
  savedAt: number;
}

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';
