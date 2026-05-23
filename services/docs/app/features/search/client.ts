import MiniSearch, { type SearchResult as MiniHit } from 'minisearch';

import {
  createMiniSearch,
  DEFAULT_SEARCH_OPTIONS,
  type SearchDoc,
  type SerializedIndex,
} from './build-index';
import { extractTerms } from './snippet';
import type { SearchResult } from './types';

/** Per-locale promise cache. A `Map` (vs the old single-cell pair of
 *  `cache + cachedLocale`) is the only race-safe shape: concurrent callers
 *  for different locales don't collide, and concurrent callers for the same
 *  locale dedupe onto a single in-flight fetch. */
const indexCache = new Map<string, Promise<MiniSearch<SearchDoc>>>();

/** Below this many AND-mode hits we widen to OR. Five is enough to fill
 *  one screen of grouped results without the user perceiving the fallback. */
const AND_MIN_RESULTS = 5;

/** Snippet-window proximity rerank kicks in when the query has ≥2 tokens.
 *  These thresholds are character distances within the truncated body. */
const PROXIMITY_TIGHT = 60;
const PROXIMITY_NEAR = 200;

/**
 * Fetch the static MiniSearch index for a given locale, rehydrate it via
 * `MiniSearch.loadJSONAsync`, and cache the result. Subsequent calls for the
 * same locale return the cached instance.
 *
 * `loadJSONAsync` is preferred over `loadJSON` because it yields between
 * batches during deserialize — keeps the main thread responsive on first
 * keystroke even when the index is large.
 */
export async function loadIndex(
  locale: string,
  baseUrl = '',
): Promise<MiniSearch<SearchDoc>> {
  const cached = indexCache.get(locale);
  if (cached) return cached;

  const promise = (async () => {
    const url = `${baseUrl}/search-index-${locale}.json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`[search] failed to load ${url}: ${response.status}`);
    }
    const payload = (await response.json()) as SerializedIndex;
    const json = JSON.stringify(payload.index);
    return (
      (await MiniSearch.loadJSONAsync<SearchDoc>(json, {
        fields: ['title', 'headings', 'body'],
        storeFields: ['title', 'url', 'section', 'locale', 'body', 'weight'],
        searchOptions: DEFAULT_SEARCH_OPTIONS,
      })) ?? createMiniSearch()
    );
  })();

  // Drop the slot if the fetch fails so the next call retries instead of
  // returning a rejected promise forever.
  promise.catch(() => {
    if (indexCache.get(locale) === promise) indexCache.delete(locale);
  });

  indexCache.set(locale, promise);
  return promise;
}

/** Test-only — drops every cached locale so a fresh fetch runs next call. */
export function resetSearchCache(): void {
  indexCache.clear();
}

export async function search(
  locale: string,
  query: string,
  baseUrl = '',
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const ms = await loadIndex(locale, baseUrl);
  const tokens = extractTerms(trimmed);

  // AND keeps precision when the corpus *can* satisfy every token; if it
  // can't, OR keeps the result list non-empty. Single-token queries skip
  // the ladder — AND and OR are equivalent for one term.
  let raw: MiniHit[] = ms.search(trimmed, {
    ...DEFAULT_SEARCH_OPTIONS,
    combineWith: 'AND',
  });
  if (tokens.length >= 2 && raw.length < AND_MIN_RESULTS) {
    raw = ms.search(trimmed, {
      ...DEFAULT_SEARCH_OPTIONS,
      combineWith: 'OR',
    });
  }

  return rerank(raw, tokens);
}

/** Post-search rerank — multipliers stacked on the BM25 baseline:
 *  - `coverage`: docs matching more of the user's tokens win.
 *  - `titleBonus`: docs with the term in their title get a strong bump.
 *  - `slugBonus`: docs whose URL path contains the term win.
 *  - `bodyOnly`: docs that only matched in the body lose.
 *  - `proximity`: docs where multi-token queries cluster together win.
 *
 *  Why title/slug bonuses are needed on top of MiniSearch's `boost: { title: 4 }`:
 *  MiniSearch's BM25 sums per-term contributions, so a doc that matches multiple
 *  *prefix-expansions* of a single query token in body+headings (e.g. "config" → both
 *  "config" and "configuration" in the body) can outrank a doc that matches one
 *  expansion in the title. The bonuses re-establish title primacy across the
 *  expansion noise. */
export function rerank(
  raw: readonly MiniHit[],
  tokens: readonly string[],
): SearchResult[] {
  const tokenCount = tokens.length || 1;
  const lowerTokens = tokens.map((t) => t.toLowerCase());
  return raw
    .map((hit) => {
      // MiniSearch typed these as `string[]` on its result type and the rest
      // of the stored fields as `[key: string]: any`. Treat the stored slots
      // narrowly here so the rest of the pipeline gets typed values.
      const queryTerms: string[] = Array.isArray(hit.queryTerms)
        ? hit.queryTerms
        : [];
      const matchedTerms: string[] = Array.isArray(hit.terms) ? hit.terms : [];
      const match: Record<string, string[]> =
        hit.match && typeof hit.match === 'object' ? hit.match : {};
      const body: string = typeof hit.body === 'string' ? hit.body : '';
      const url: string = typeof hit.url === 'string' ? hit.url : '';

      const hitTokens = new Set(queryTerms.map((t) => t.toLowerCase()));
      const coverage = hitTokens.size / tokenCount;
      const fields = new Set(Object.values(match).flat());
      const titleBonus = fields.has('title') ? 1.6 : 1;
      const headingBonus =
        !fields.has('title') && fields.has('headings') ? 1.15 : 1;
      const bodyOnly = fields.size === 1 && fields.has('body');

      // Slug bonus: pages whose URL contains *any* user-typed token deserve
      // ranking lift — the URL is a curated signal that the page is *about*
      // that topic (e.g. /configuration/retention beats a random body match).
      const lowerUrl = url.toLowerCase();
      const slugHit = lowerTokens.some(
        (t) => t.length >= 3 && lowerUrl.includes(t),
      );
      const slugBonus = slugHit ? 1.25 : 1;

      const proximity =
        tokens.length >= 2 ? proximityBoost(body, lowerTokens) : 1;

      const baseScore = typeof hit.score === 'number' ? hit.score : 0;
      const score =
        baseScore *
        (0.6 + 0.4 * coverage) *
        titleBonus *
        headingBonus *
        slugBonus *
        (bodyOnly ? 0.6 : 1) *
        proximity;

      return {
        id: String(hit.id),
        title: typeof hit.title === 'string' ? hit.title : '',
        url,
        section: typeof hit.section === 'string' ? hit.section : undefined,
        locale: typeof hit.locale === 'string' ? hit.locale : undefined,
        body: body || undefined,
        score,
        matchedTerms,
        queryTerms,
        match,
      } satisfies SearchResult;
    })
    .sort((a, b) => b.score - a.score);
}

/** Proximity heuristic — find each token's first occurrence in the body and
 *  measure the spread. Small spreads imply phrase-like matches. Tokens
 *  are lowercased defensively so callers can pass either form. */
export function proximityBoost(
  body: string,
  tokens: readonly string[],
): number {
  if (!body || tokens.length < 2) return 1;
  const lower = body.toLowerCase();
  const positions: number[] = [];
  for (const t of tokens) {
    const needle = t.toLowerCase();
    if (!needle) continue;
    const idx = lower.indexOf(needle);
    if (idx >= 0) positions.push(idx);
  }
  if (positions.length < 2) return 1;
  const window = Math.max(...positions) - Math.min(...positions);
  if (window < PROXIMITY_TIGHT) return 1.4;
  if (window < PROXIMITY_NEAR) return 1.15;
  return 1;
}
