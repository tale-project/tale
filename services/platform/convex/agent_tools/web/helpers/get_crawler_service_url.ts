/**
 * Helper: getCrawlerServiceUrl
 *
 * Resolve the crawler service base URL from agent variables or environment.
 */

export function getCrawlerServiceUrl(
  variables?: Record<string, unknown>,
): string {
  const fromVars = variables?.crawlerServiceUrl;
  return (
    (typeof fromVars === 'string' ? fromVars : '') ||
    process.env.CRAWLER_URL ||
    'http://localhost:8002'
  );
}
