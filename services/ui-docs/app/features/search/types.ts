/** A MiniSearch hit after rerank. The shared `@tale/ui/search` palette
 *  consumes the normalised `SearchResult` — see `source.ts` for the mapping
 *  (`url → href`, `section → group`). */
export interface SearchResult {
  id: string;
  title: string;
  /** Site-relative URL of the page. */
  url: string;
  /** Section key — the top-level slug segment (e.g. `components`). */
  section?: string;
  /** Stripped body — renders the snippet and counts secondary matches. */
  body?: string;
  /** Final score after rerank. */
  score: number;
  /** Index terms that matched. Drives highlight + snippet centring. */
  matchedTerms: string[];
  /** User tokens that produced matches — a subset of the typed query. */
  queryTerms: string[];
  /** Matched index term → the fields it hit. Drives the result-row icon. */
  match: Record<string, string[]>;
}

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';
