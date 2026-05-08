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
  /** MiniSearch relevance score. */
  score: number;
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
