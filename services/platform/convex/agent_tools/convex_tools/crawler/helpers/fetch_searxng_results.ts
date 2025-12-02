/**
 * Helper: fetchSearXNGResults
 *
 * Performs a search against the SearXNG meta search engine.
 */

import {
  type SearchOptions,
  type SearchResult,
  type SearXNGResponse,
} from './types';

export async function fetchSearXNGResults(
  serviceUrl: string,
  options: SearchOptions,
): Promise<{
  items: SearchResult[];
  totalResults: number;
  suggestions: string[];
}> {
  const url = new URL(`${serviceUrl}/search`);

  // Build query - prepend site: filter if specified
  let finalQuery = options.query;
  if (options.site) {
    finalQuery = `site:${options.site} ${options.query}`;
  }
  url.searchParams.set('q', finalQuery);
  url.searchParams.set('format', 'json');
  url.searchParams.set('pageno', String(options.pageNo ?? 1));

  if (options.engines && options.engines.length > 0) {
    url.searchParams.set('engines', options.engines.join(','));
  }

  if (options.categories && options.categories.length > 0) {
    url.searchParams.set('categories', options.categories.join(','));
  }

  if (options.timeRange) {
    url.searchParams.set('time_range', options.timeRange);
  }

  if (options.safesearch !== undefined) {
    url.searchParams.set('safesearch', String(options.safesearch));
  }

  if (options.language) {
    url.searchParams.set('language', options.language);
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SearXNG Search API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as SearXNGResponse;
  const numResults = options.numResults ?? 10;

  const items: SearchResult[] = (data.results || [])
    .slice(0, numResults)
    .map((item) => ({
      title: item.title || '',
      link: item.url || '',
      snippet: item.content || '',
      engines: item.engines,
      publishedDate: item.publishedDate,
      category: item.category,
    }));

  return {
    items,
    totalResults: data.number_of_results || items.length,
    suggestions: data.suggestions || [],
  };
}
