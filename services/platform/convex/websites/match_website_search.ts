import type { Doc } from '../lib/rows';

/**
 * Case-insensitive substring match of `searchLower` against a website's domain,
 * title, or description. `searchLower` must already be lowercased.
 */
export function matchesWebsiteSearch(
  website: Pick<Doc<'websites'>, 'domain' | 'title' | 'description'>,
  searchLower: string,
): boolean {
  return (
    website.domain.toLowerCase().includes(searchLower) ||
    !!website.title?.toLowerCase().includes(searchLower) ||
    !!website.description?.toLowerCase().includes(searchLower)
  );
}
