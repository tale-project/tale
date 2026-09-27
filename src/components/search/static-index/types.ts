/** A MiniSearch hit after rerank — the result shape `client.ts` produces. The
 *  shared palette consumes the normalised `SearchResult` instead; see
 *  `source.ts` for the mapping (`url → href`, `section → group`). */
export interface StaticSearchHit {
  /** Document id, e.g. a locale-prefixed slug (`en:platform/chat`). */
  id: string;
  /** Page title from frontmatter. */
  title: string;
  /** Site-relative URL of the page. */
  url: string;
  /** Section key — the top-level slug segment (e.g. "platform", "cloud"). */
  section?: string;
  /** Locale tag (e.g. "en", "de", "fr") when the site indexes per locale. */
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
