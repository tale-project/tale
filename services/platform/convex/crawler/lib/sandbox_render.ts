'use node';

/**
 * Headless page render delegated to a sandbox SESSION (Playwright/Chromium).
 *
 * The Python crawler used crawl4ai (headless Chromium via Playwright) to fetch
 * AND JS-render every page. In the platform-internal architecture there is no
 * Chromium inside the Convex Node runtime, so JS rendering is DELEGATED to
 * `services/sandbox-runtime`, which ships Chromium + Playwright pre-baked in its
 * execution image (`PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`). Rendering is
 * expressed as a tiny Playwright Node script run in an EPHEMERAL render session
 * (create → run → read output → destroy); its `/user/output/page.json` output is
 * read straight off the session and parsed back into Convex. See
 * {@link renderInSession}. Every sandbox run is a session now — there is no
 * one-shot path left. Renders draw from the isolated per-org 'render' session
 * budget so heavy crawling can't starve interactive agent / run_code sessions.
 */

import type { GenericActionCtx } from 'convex/server';

import type { DataModel } from '../../_generated/dataModel';
import {
  netscapeJarToPlaywrightCookies,
  type PlaywrightCookie,
} from '../../browser_sessions/cookie_header';
import { renderInSession } from './render_session';

/**
 * Minimal context a sandbox render needs: an action `ctx` (for the render
 * session + output read-back) and the owning org for the session budget.
 */
export interface SandboxRenderContext {
  ctx: GenericActionCtx<DataModel>;
  organizationId: string;
}

export interface SandboxRenderResult {
  /** Final URL after redirects, as reported by Playwright. */
  url: string;
  /** Rendered HTML (`document.documentElement.outerHTML`). */
  html: string;
}

const DEFAULT_RENDER_TIMEOUT_MS = 30_000;

/**
 * Build the Playwright render script. It navigates to `url`, waits for the
 * network to settle, and writes the rendered HTML + final URL to
 * `/user/output/page.json` (harvested off the session).
 *
 * The script is intentionally self-contained — `require('playwright')` resolves
 * against the sandbox-runtime image's pre-baked install.
 */
function buildRenderScript(
  url: string,
  userAgent: string,
  timeoutMs: number,
  cookies: PlaywrightCookie[],
): string {
  return [
    // The sandbox image bakes Playwright under the Playwright MCP package (NOT
    // on the runner's NODE_PATH), with Chromium at PLAYWRIGHT_BROWSERS_PATH. A
    // bare `require('playwright')` therefore fails with MODULE_NOT_FOUND;
    // resolve it from the baked location, falling back to a normal require for
    // any other runtime.
    'const { chromium } = (() => {',
    "  const baked = '/opt/agents/lib/node_modules/@playwright/mcp';",
    '  try {',
    "    return require(require.resolve('playwright', { paths: [baked] }));",
    '  } catch (e) {',
    "    return require('playwright');",
    '  }',
    '})();',
    "const fs = require('fs');",
    `const cookies = ${JSON.stringify(cookies)};`,
    '(async () => {',
    "  const browser = await chromium.launch({ args: ['--no-sandbox'] });",
    '  try {',
    // A fresh context (not the default page) so pre-warmed session cookies can
    // be seeded before the first navigation — a bot-walled host then sees a
    // returning visitor.
    `    const context = await browser.newContext({ userAgent: ${JSON.stringify(userAgent)} });`,
    '    if (cookies.length) { try { await context.addCookies(cookies); } catch (e) { console.error("addCookies failed:", String(e)); } }',
    '    const page = await context.newPage();',
    `    const response = await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle', timeout: ${timeoutMs} });`,
    '    const html = await page.content();',
    '    const finalUrl = page.url();',
    '    const status = response ? response.status() : 0;',
    "    fs.mkdirSync('/user/output', { recursive: true });",
    "    fs.writeFileSync('/user/output/page.json', JSON.stringify({ url: finalUrl, html, status }));",
    '  } finally {',
    '    await browser.close();',
    '  }',
    '})().catch((err) => {',
    '  console.error(err && err.stack ? err.stack : String(err));',
    '  process.exit(1);',
    '});',
  ].join('\n');
}

/**
 * Render `url` in an ephemeral sandbox render session via Playwright and return
 * the HTML.
 *
 * Throws on any render failure (session at capacity, non-completed status,
 * missing/malformed output). Callers fall back to a plain fetch.
 */
export async function renderUrlInSandbox(
  renderCtx: SandboxRenderContext,
  url: string,
  options: { timeoutMs?: number; userAgent?: string; cookieJar?: string } = {},
): Promise<SandboxRenderResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const userAgent =
    options.userAgent ??
    'Mozilla/5.0 (compatible; TaleCrawler/1.0; +https://tale.dev)';
  const cookies = options.cookieJar
    ? netscapeJarToPlaywrightCookies(options.cookieJar)
    : [];

  const { ctx, organizationId } = renderCtx;
  const script = buildRenderScript(url, userAgent, timeoutMs, cookies);
  const renderKey = `crawler-render-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  const output = await renderInSession(ctx, {
    organizationId,
    renderKey,
    scriptContent: script,
    outputFileName: 'page.json',
    timeoutMs,
    logTag: 'crawler',
  });

  const parsed: unknown = JSON.parse(
    Buffer.from(output.bytes).toString('utf8'),
  );
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('rendered output payload is not an object');
  }
  const htmlVal = Reflect.get(parsed, 'html');
  const urlVal = Reflect.get(parsed, 'url');
  if (typeof htmlVal !== 'string') {
    throw new Error('rendered output payload has no html string');
  }
  const finalUrl =
    typeof urlVal === 'string' && urlVal.length > 0 ? urlVal : url;
  return { url: finalUrl, html: htmlVal };
}
