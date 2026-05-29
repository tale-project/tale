/** A MiniSearch hit after rerank — the docs-internal result shape produced by
 *  `client.ts`. The shared `@tale/ui/search` palette consumes the normalised
 *  `SearchResult` (see `source.ts` for the mapping `url → href`,
 *  `section → group`). */
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
  /** User tokens that produced matches — subset of the typed query. */
  queryTerms: string[];
  /** Map of matched index term → fields it hit in (`title`, `headings`,
   *  `body`). Drives field-aware ranking and the result-row icon. */
  match: Record<string, string[]>;
}

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';
