import MiniSearch from 'minisearch';

import {
  createMiniSearch,
  type SearchDoc,
  type SerializedIndex,
} from './build-index';

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  section?: string;
  locale?: string;
  score: number;
}

let cache: Promise<MiniSearch<SearchDoc>> | null = null;
let cachedLocale: string | null = null;

/**
 * Fetch the static MiniSearch index for a given locale, rehydrate it via
 * `MiniSearch.loadJSON`, and cache the result. Subsequent calls for the
 * same locale return the cached instance.
 */
export async function loadIndex(
  locale: string,
  baseUrl = '',
): Promise<MiniSearch<SearchDoc>> {
  if (cache && cachedLocale === locale) return cache;
  cachedLocale = locale;
  cache = (async () => {
    const url = `${baseUrl}/search-index-${locale}.json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`[search] failed to load ${url}: ${response.status}`);
    }
    const payload = (await response.json()) as SerializedIndex;
    const json = JSON.stringify(payload.index);
    return (
      MiniSearch.loadJSON<SearchDoc>(json, {
        fields: ['title', 'headings', 'body'],
        storeFields: ['title', 'url', 'section', 'locale'],
      }) ?? createMiniSearch()
    );
  })();
  return cache;
}

export async function search(
  locale: string,
  query: string,
  baseUrl = '',
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const ms = await loadIndex(locale, baseUrl);
  return ms.search(trimmed) as unknown as SearchResult[];
}
