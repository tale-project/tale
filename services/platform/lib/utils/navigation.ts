/**
 * Checks if a given URL matches the current pathname and search parameters
 * @param itemHref - The href to match against
 * @param pathname - The current pathname
 * @param searchParams - The current search parameters
 * @param isNested - Whether to use startsWith matching for nested paths
 * @returns boolean indicating if the URL matches
 */
export function isNavigationUrlMatch(
  itemHref: string,
  pathname: string,
  searchParams: URLSearchParams,
  isNested: boolean,
): boolean {
  // Split the href into pathname and search parts
  const [itemPath, itemSearch] = itemHref.split('?');

  // For exact path matching, we need to handle trailing slashes
  const normalizedPathname = pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
  const normalizedItemPath = itemPath.endsWith('/')
    ? itemPath.slice(0, -1)
    : itemPath;

  // Check if pathname matches - only use startsWith for nested paths that have additional segments
  const pathMatches = isNested
    ? normalizedPathname.startsWith(normalizedItemPath)
    : normalizedPathname === normalizedItemPath;

  // If there's no search params in the item href, just check pathname
  if (!itemSearch) return pathMatches;

  // If there are search params, check if they match
  const itemSearchParams = new URLSearchParams(itemSearch);
  for (const [key, value] of itemSearchParams) {
    if (searchParams.get(key) !== value) return false;
  }

  return pathMatches;
}
