'use node';

/**
 * Fetch a URL and return its rendered HTML.
 *
 * The Python crawler used crawl4ai (headless Chromium via Playwright) to fetch
 * AND JS-render every page. In the platform-internal architecture the page
 * fetch/render is DELEGATED to `sandbox-runtime`, which already ships
 * Chromium/Playwright inside its execution container. There is no dedicated
 * "browse" endpoint on the spawner — it is a code-execution service
 * (`POST /v1/execute`, see convex/node_only/sandbox/helpers/spawner_client.ts).
 * Rendering is therefore expressed as a tiny Playwright Node script dispatched
 * as the spawner's `entryPath`, whose harvested output file carries the HTML
 * back to Convex storage. See `./lib/sandbox_render.ts` for the dispatch helper
 * and its assumption/TODO(verify) block.
 *
 * Two paths:
 *
 *  - DEFAULT (`fetch`): a plain HTTP GET with a browser-like User-Agent. This
 *    is correct + sufficient for static / server-rendered pages — the dominant
 *    case for sitemapped documentation sites the crawler targets. Runs entirely
 *    in this node action; no sandbox round-trip.
 *
 *  - `CRAWLER_RENDER_VIA_SANDBOX=1` (sandbox render): delegate a Playwright
 *    render to the spawner via `renderUrlInSandbox`. Requires a render context
 *    (action `ctx` + organizationId) to be threaded through from the calling
 *    node action; when the env flag is set but no context was supplied (e.g. a
 *    lib path that has no `ctx`), it logs a warning and falls back to plain
 *    fetch. *** This path is a DOCUMENTED SEAM and is UNVERIFIED against a live
 *    spawner/storage stack *** — see `./lib/sandbox_render.ts`. Any sandbox
 *    failure falls back to plain fetch (best-effort, so a crawl is never wholly
 *    blocked by an unhealthy spawner).
 */

import {
  renderUrlInSandbox,
  type SandboxRenderContext,
} from '../lib/sandbox_render';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; TaleCrawler/1.0; +https://tale.dev)';

export interface FetchRenderedResult {
  url: string;
  status: number;
  html: string;
  /** True when JS rendering was applied (sandbox path); false for plain fetch. */
  rendered: boolean;
}

export interface FetchRenderedOptions {
  timeoutMs?: number;
  userAgent?: string;
  /**
   * Sandbox render context (action `ctx` + organizationId). When present AND
   * `CRAWLER_RENDER_VIA_SANDBOX=1`, the page is JS-rendered via the spawner;
   * otherwise a plain fetch is used. Threaded down from the calling node
   * action so the lib layer stays `ctx`-free where rendering isn't requested.
   */
  renderContext?: SandboxRenderContext;
}

/**
 * Fetch + (optionally) render a URL to HTML.
 *
 * @throws if the URL is unreachable or returns a non-2xx/3xx status the caller
 *         should treat as a hard failure (callers inspect `.status`).
 */
export async function fetchRenderedHtml(
  url: string,
  options: FetchRenderedOptions = {},
): Promise<FetchRenderedResult> {
  if (
    process.env.CRAWLER_RENDER_VIA_SANDBOX === '1' &&
    options.renderContext !== undefined
  ) {
    try {
      const rendered = await renderUrlInSandbox(options.renderContext, url, {
        timeoutMs: options.timeoutMs,
        userAgent: options.userAgent,
      });
      // Playwright's `page.goto` already followed redirects and threw on
      // network errors; a completed render is treated as HTTP 200. (The
      // render script captures the response status but the markdown pipeline
      // only needs `< 400` here; non-2xx static responses still surface via
      // the plain-fetch path when sandbox rendering is disabled.)
      return {
        url: rendered.url,
        status: 200,
        html: rendered.html,
        rendered: true,
      };
    } catch (err) {
      console.warn(
        `[crawler] sandbox render failed for ${url}, falling back to plain fetch: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else if (
    process.env.CRAWLER_RENDER_VIA_SANDBOX === '1' &&
    options.renderContext === undefined
  ) {
    console.warn(
      `[crawler] CRAWLER_RENDER_VIA_SANDBOX=1 but no render context was threaded ` +
        `to fetchRenderedHtml for ${url}; falling back to plain fetch.`,
    );
  }
  return plainFetch(url, options);
}

async function plainFetch(
  url: string,
  options: FetchRenderedOptions,
): Promise<FetchRenderedResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const res = await fetch(url, {
    headers: { 'user-agent': options.userAgent ?? DEFAULT_USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  const html = await res.text();
  return { url: res.url || url, status: res.status, html, rendered: false };
}
