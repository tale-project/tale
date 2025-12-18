/**
 * Helper: getSearchServiceUrl
 *
 * Resolve the SearXNG search service base URL from agent variables or environment.
 */

export function getSearchServiceUrl(
  variables?: Record<string, unknown>,
): string {
  const fromVariables = variables?.SEARCH_SERVICE_URL;
  if (typeof fromVariables === 'string' && fromVariables) {
    return fromVariables;
  }
  return process.env.SEARCH_SERVICE_URL || 'http://localhost:8003';
}
