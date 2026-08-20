'use node';

/**
 * The crawler's render lane: fetch a batch of HTML pages through a headless
 * browser inside an ephemeral sandbox session, so JS-rendered sites (SPA
 * shells) yield their real content. This finishes wiring the `render`
 * session lane the platform already scaffolds (`sessionIdForRender`,
 * `ownerType: 'render'` with its own org quota).
 *
 * Division of labour with the crawl engine: the engine's plain probe GET
 * remains the authority on page LIFECYCLE (2xx/404/deletes, size caps,
 * content-type dispatch, SSRF guards for every byte download) — the render
 * worker only turns an already-probed HTML page into its rendered DOM.
 * Binaries never enter the sandbox.
 *
 * Failure semantics are two-tier by design:
 *  - Infra failures (quota, session create, exec transport, no output file)
 *    THROW — the caller fails the whole scan visibly and retries next
 *    interval; per-page `fail_count` is never charged for a down sandbox.
 *  - Per-URL render outcomes (nav timeout, blocked redirect, oversized DOM)
 *    come back as `failed` and are charged to that page alone.
 *
 * One session per batch, destroyed in `finally` — a session never spans
 * loop iterations or scan continuation links.
 */

import { z } from 'zod';

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { sessionIdForRender } from '../../sandbox/session_naming';
import {
  sessionCreate,
  sessionDestroy,
  sessionReadFile,
  sessionStageFiles,
} from './helpers/session_client';
import { runStepsInSession } from './session_exec';

/** Per-page navigation budget inside the worker. */
const RENDER_PAGE_TIMEOUT_MS = 20_000;
/** How long the worker waits for network-idle after DOMContentLoaded. */
const RENDER_IDLE_TIMEOUT_MS = 5_000;
/** The worker stops STARTING pages this far before the exec hard kill, so
 * it always exits cleanly with its partial results on disk. */
const WORKER_EXIT_MARGIN_MS = 20_000;
/** Rendered-DOM caps: per page, and total per batch — `sessionReadFile`
 * serves at most 20MB, so the output file must stay safely under it. */
const RENDER_MAX_HTML_BYTES = 6 * 1024 * 1024;
const RENDER_MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export type RenderPageOutcome =
  | { kind: 'ok'; status: number; finalUrl: string; html: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'not_attempted' };

export interface RenderBatchArgs {
  organizationId: string;
  urls: readonly string[];
  /** Unique per batch — feeds the session id AND the per-owner slot, so
   * concurrent batches (different domains, same org) never collide. */
  batchKey: string;
  /** Wall-clock budget for the sandbox exec, already clamped by the caller
   * against its own action deadline. */
  execTimeoutMs: number;
}

/** The worker's output file is a boundary: validate, never trust. Records
 * that fail the schema are ignored (their URL stays `not_attempted`). */
const renderRecordSchema = z.object({
  url: z.string(),
  attempted: z.boolean().optional(),
  status: z.number().optional(),
  finalUrl: z.string().optional(),
  html: z.string().optional(),
  error: z.string().optional(),
});
const renderPayloadSchema = z.object({ pages: z.array(z.unknown()) });

/**
 * Map the worker's output file onto per-URL outcomes. A URL the worker never
 * reached (or a malformed record) is `not_attempted` — the row stays due and
 * the next continuation link retries it.
 */
export function parseRenderResults(
  payload: unknown,
  urls: readonly string[],
): Map<string, RenderPageOutcome> {
  const byUrl = new Map<string, RenderPageOutcome>();
  for (const url of urls) byUrl.set(url, { kind: 'not_attempted' });
  const parsed = renderPayloadSchema.safeParse(payload);
  if (!parsed.success) return byUrl;
  for (const entry of parsed.data.pages) {
    const record = renderRecordSchema.safeParse(entry);
    if (!record.success) continue;
    const { url, attempted, status, finalUrl, html, error } = record.data;
    if (!byUrl.has(url) || attempted !== true) continue;
    if (html !== undefined && status !== undefined) {
      byUrl.set(url, {
        kind: 'ok',
        status,
        finalUrl: finalUrl ?? url,
        html,
      });
      continue;
    }
    byUrl.set(url, {
      kind: 'failed',
      reason:
        error !== undefined && error.length > 0
          ? error
          : 'render produced no content',
    });
  }
  return byUrl;
}

/**
 * Render one batch of URLs in a throwaway sandbox session and return the
 * per-URL outcomes. Throws on any infrastructure failure (see module doc).
 */
export async function renderUrlsInSandbox(
  ctx: ActionCtx,
  args: RenderBatchArgs,
): Promise<Map<string, RenderPageOutcome>> {
  const sessionId = sessionIdForRender(args.batchKey);
  const rowId = await ctx.runMutation(
    internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
    {
      organizationId: args.organizationId,
      sessionId,
      profile: 'default',
      ownerType: 'render',
      ownerId: sessionId,
      createdBy: 'system:crawler',
    },
  );

  let created = false;
  try {
    try {
      await sessionCreate({
        sessionId,
        organizationId: args.organizationId,
        profile: 'default',
      });
      created = true;
    } catch (error) {
      // Roll the reserved row out of the way so the freed slot wakes any
      // parked waiter and a retry is not blocked by the per-owner cap.
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        {
          rowId,
          status: 'failed',
        },
      );
      throw error;
    }
    await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
      rowId,
      status: 'active',
    });

    const workerInput = {
      urls: args.urls,
      perPageTimeoutMs: RENDER_PAGE_TIMEOUT_MS,
      idleTimeoutMs: RENDER_IDLE_TIMEOUT_MS,
      softBudgetMs: Math.max(
        30_000,
        args.execTimeoutMs - WORKER_EXIT_MARGIN_MS,
      ),
      maxHtmlBytes: RENDER_MAX_HTML_BYTES,
      maxTotalBytes: RENDER_MAX_TOTAL_BYTES,
    };
    await sessionStageFiles(sessionId, [
      {
        path: 'code/render.mjs',
        contentBase64: Buffer.from(RENDER_WORKER_SOURCE, 'utf8').toString(
          'base64',
        ),
      },
      {
        path: 'code/urls.json',
        contentBase64: Buffer.from(
          JSON.stringify(workerInput),
          'utf8',
        ).toString('base64'),
      },
    ]);

    const run = await runStepsInSession(sessionId, {
      stepPaths: ['/agent/code/render.mjs'],
      timeoutMs: args.execTimeoutMs,
    });
    // The worker rewrites its output after every page, so even a hard-killed
    // exec leaves partial results behind; only a MISSING file is an infra
    // failure worth failing the scan over.
    const file = await sessionReadFile(sessionId, '/agent/output/pages.json');
    if (!file) {
      const detail = [
        `status ${run.status}`,
        run.errorMessage ?? '',
        run.stderr.slice(-400),
      ]
        .filter((part) => part.length > 0)
        .join(' — ');
      throw new Error(`render worker produced no output (${detail})`);
    }
    const payload: unknown = JSON.parse(new TextDecoder().decode(file.bytes));
    return parseRenderResults(payload, args.urls);
  } finally {
    if (created) {
      try {
        await sessionDestroy(sessionId);
      } catch (error) {
        console.warn(
          `[render] session ${sessionId} destroy failed (teardown cron will reap it):`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    try {
      await ctx.runMutation(
        internal.sandbox.session_mutations.markSessionRowDestroyed,
        { organizationId: args.organizationId, sessionId },
      );
    } catch (error) {
      console.warn(
        `[render] session ${sessionId} row flip failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/**
 * The worker staged into the sandbox. Plain node ESM (`.mjs` — the step
 * runner has no TS interpreter). Resolves playwright from the paths the
 * sandbox image bakes and verifies at build time; launches Chromium with the
 * egress proxy passed EXPLICITLY (Chromium ignores proxy env vars, and the
 * sandbox bridge is internal-only — without `--proxy-server` every
 * navigation dies). Re-validates hostnames because the engine-side SSRF
 * guard does not travel into the sandbox: single-label hosts (docker service
 * aliases like `convex`) and private/link-local IP literals are refused, on
 * the original URL and again on the post-redirect landing host.
 */
const RENDER_WORKER_SOURCE = `
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const requireModule = createRequire(import.meta.url);
const PLAYWRIGHT_CANDIDATES = [
  '/opt/agents/lib/node_modules/@playwright/mcp/node_modules/playwright-core',
  '/opt/agents/skills/visual-aspect-analyzer/node_modules/playwright',
  'playwright-core',
  'playwright',
];

function loadChromium() {
  const failures = [];
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try {
      const mod = requireModule(candidate);
      if (mod && mod.chromium) return mod.chromium;
      failures.push(candidate + ': no chromium export');
    } catch (error) {
      failures.push(candidate + ': ' + (error && error.message ? error.message : String(error)));
    }
  }
  throw new Error('playwright is not resolvable in this sandbox image: ' + failures.join(' | '));
}

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === '' || !host.includes('.')) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  const ipv4 = /^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (host.includes(':')) return true;
  return false;
}

const input = JSON.parse(readFileSync('/agent/code/urls.json', 'utf8'));
const urls = Array.isArray(input.urls) ? input.urls : [];
const perPageTimeoutMs = input.perPageTimeoutMs || 20000;
const idleTimeoutMs = input.idleTimeoutMs || 5000;
const softBudgetMs = input.softBudgetMs || 180000;
const maxHtmlBytes = input.maxHtmlBytes || 6291456;
const maxTotalBytes = input.maxTotalBytes || 15728640;

const startedAt = Date.now();
const records = new Map();
for (const url of urls) records.set(url, { url, attempted: false });
mkdirSync('/agent/output', { recursive: true });
function flush() {
  writeFileSync(
    '/agent/output/pages.json',
    JSON.stringify({ pages: Array.from(records.values()) }),
  );
}
flush();

const chromium = loadChromium();
const proxyServer =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy;
const launchOptions = { headless: true };
if (proxyServer) {
  launchOptions.proxy = { server: proxyServer };
  const bypass = process.env.NO_PROXY || process.env.no_proxy;
  if (bypass) launchOptions.proxy.bypass = bypass;
}

const browser = await chromium.launch(launchOptions);
let totalBytes = 0;
try {
  const context = await browser.newContext();
  for (const url of urls) {
    if (Date.now() - startedAt > softBudgetMs) break;
    if (totalBytes > maxTotalBytes) break;
    const record = records.get(url);
    record.attempted = true;
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      record.error = 'unparseable URL';
      flush();
      continue;
    }
    if (isBlockedHost(hostname)) {
      record.error = 'blocked host';
      flush();
      continue;
    }
    const page = await context.newPage();
    try {
      const response = await page.goto(url, {
        timeout: perPageTimeoutMs,
        waitUntil: 'domcontentloaded',
      });
      await page
        .waitForLoadState('networkidle', { timeout: idleTimeoutMs })
        .catch(() => {});
      // SPAs go network-quiet between boot and their data fetch, so idle
      // alone captures the shell. Wait until the rendered TEXT stops
      // growing: stable across two samples (or the cap) is the document.
      const settleDeadline = Date.now() + Math.min(perPageTimeoutMs, 15000);
      let previousLength = -1;
      let stableSamples = 0;
      while (Date.now() < settleDeadline && stableSamples < 2) {
        const length = await page
          .evaluate('document.body ? document.body.innerText.length : 0')
          .catch(() => 0);
        if (length === previousLength && length > 0) stableSamples += 1;
        else stableSamples = 0;
        previousLength = length;
        if (stableSamples < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      const finalUrl = page.url();
      let finalHost = '';
      try {
        finalHost = new URL(finalUrl).hostname;
      } catch {
        finalHost = '';
      }
      const status = response ? response.status() : 0;
      if (finalHost === '' || isBlockedHost(finalHost)) {
        record.error = 'redirected to a blocked host';
      } else if (status < 200 || status >= 300) {
        record.status = status;
        record.error = 'HTTP ' + status + ' at render time';
      } else {
        const html = await page.content();
        if (html.length > maxHtmlBytes) {
          record.error = 'rendered HTML exceeds the per-page bound';
        } else {
          record.status = status;
          record.finalUrl = finalUrl;
          record.html = html;
          totalBytes += html.length;
        }
      }
    } catch (error) {
      record.error = (error && error.message ? String(error.message) : 'navigation failed').slice(0, 500);
    } finally {
      await page.close().catch(() => {});
    }
    flush();
  }
} finally {
  await browser.close().catch(() => {});
}
flush();
`;
