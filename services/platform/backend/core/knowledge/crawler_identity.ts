/**
 * How the crawler introduces itself to the sites it visits.
 *
 * RFC 9309 §2.2.1 lets a site owner address ONE crawler by its product
 * token — allow it, throttle it (`Crawl-delay`) or refuse it alone — and
 * tell its traffic from a scraper's in their logs; a bare `node` (Node's
 * `fetch` default) on the probe leg and a stock Chrome string on the render
 * leg gave them nothing to hold (2026-09-15 evaluation, i6). Both legs
 * carry this one string: the in-process probe (`crawl_action.ts`) and the
 * sandboxed render worker (`render_fetch.ts`).
 */

/** The product token a `robots.txt` group can name. */
export const CRAWLER_PRODUCT_TOKEN = 'TaleBot';

/** Where a site owner reads what the crawler does and how to reach us. */
export const CRAWLER_INFO_URL =
  'https://docs.tale.dev/platform/knowledge/crawling';

/**
 * `TaleBot/<version> (+<info url>)` — the conventional shape: a product
 * token, its version and a `+URL` comment. The version is the deployment's
 * (`TALE_VERSION`), `dev` when unset; anything outside the characters a
 * product version takes is dropped, so an odd build label can never break
 * the header value.
 */
export function crawlerUserAgent(version: string | undefined): string {
  const safe = (version ?? '').replace(/[^0-9A-Za-z.+-]/g, '');
  return `${CRAWLER_PRODUCT_TOKEN}/${safe === '' ? 'dev' : safe} (+${CRAWLER_INFO_URL})`;
}

/** The request headers every crawler fetch carries. */
export function crawlerRequestHeaders(
  version: string | undefined = process.env.TALE_VERSION,
): Record<string, string> {
  return { 'User-Agent': crawlerUserAgent(version) };
}
