/**
 * Helper: getCrawlerServiceUrl
 *
 * Resolve the crawler service base URL from agent variables or environment.
 */

export function getCrawlerServiceUrl(
  variables?: Record<string, unknown>,
): string {
  return (
    (variables?.crawlerServiceUrl as string) ||
    process.env.CRAWLER_URL ||
    'http://localhost:8002'
  );
}
