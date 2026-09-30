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
 *  - Infra failures (quota, session create, exec transport, no output file,
 *    a worker that stopped before it attempted a page) THROW — the caller
 *    fails the whole scan visibly and retries next interval; per-page
 *    `fail_count` is never charged for a down sandbox.
 *    The worker reports the lane's own faults the same way, as a `halted`
 *    marker beside its pages: the egress proxy refusing the tunnel, or the
 *    browser gone — the caller stores what rendered and throws for the rest.
 *  - Per-URL render outcomes (nav timeout, blocked redirect, oversized DOM,
 *    a page the worker was cut off in) come back as `failed` and are
 *    charged to that page alone. A navigation
 *    the browser lost (a crashed helper process, an aborted document) is
 *    retried once in a fresh context; when that fails too the outcome is
 *    `failed` with `transient` set, and the caller records it without a
 *    strike (`lib/knowledge/crawl-parse.ts`, the failure classes).
 *
 * One session per batch, destroyed in `finally` — a session never spans
 * loop iterations or scan continuation links. A batch whose create failed
 * never had a session to destroy there: its row is left `failed` for the
 * sandbox watchdog to collect (`settleFailedCreate`).
 */

import { z } from 'zod';

import {
  RENDER_CRASH_ERROR_PATTERN,
  RENDER_PROXY_ERROR_PATTERN,
  RENDER_UNFINISHED_REASON,
  type RenderLaneHalt,
} from '../../../../lib/knowledge/crawl-parse';
import { crawlerUserAgent } from '../../knowledge/crawler_identity';
import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import { sessionIdForRender } from '../../sandbox/session_naming';
import {
  SessionDuplicateError,
  sessionCreate,
  sessionDestroy,
  sessionDestroyIfIdle,
  sessionReadFile,
  sessionStageFiles,
} from './helpers/session_client';
import { RENDERED_LAYOUT_SCRIPT } from './render_layout';
import { runStepsInSession } from './session_exec';

/** Per-page navigation budget inside the worker. */
const RENDER_PAGE_TIMEOUT_MS = 20_000;
/** How long the worker waits for network-idle after DOMContentLoaded. */
const RENDER_IDLE_TIMEOUT_MS = 5_000;
/** The worker stops STARTING pages this far before the exec hard kill, so
 * it always exits cleanly with its partial results on disk. */
const WORKER_EXIT_MARGIN_MS = 20_000;
/** Rendered-DOM caps in BYTES: per page, and for the whole output file —
 * `sessionReadFile` serves at most 20MB, and an output the host cannot read
 * back fails the batch deterministically (the crawl would retry the same
 * batch forever), so the worker bounds the serialized file before it admits
 * each page. */
const RENDER_MAX_HTML_BYTES = 6 * 1024 * 1024;
const RENDER_MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export type RenderPageOutcome =
  | { kind: 'ok'; status: number; finalUrl: string; html: string }
  | {
      kind: 'failed';
      reason: string;
      /** The browser lost this navigation twice (a crashed helper process,
       * an aborted document): the row records the reason, uncharged. */
      transient: boolean;
    }
  | { kind: 'not_attempted' };

/** One batch as the worker left it: an outcome per URL, and why it stopped
 * early when it did — a lane fault the caller fails the scan over. */
export interface RenderBatchResult {
  readonly outcomes: Map<string, RenderPageOutcome>;
  readonly halted: RenderLaneHalt | null;
}

export interface RenderBatchArgs {
  organizationId: string;
  urls: readonly string[];
  /** Unique per batch — feeds the session id AND the per-owner slot, so
   * concurrent batches (different domains, same org) never collide. */
  batchKey: string;
  /** Wall-clock budget for the sandbox exec, already clamped by the caller
   * against its own action deadline. */
  execTimeoutMs: number;
  /** The site's robots.txt `Crawl-delay`, in ms — the pause the worker
   * keeps between two page loads (2026-09-18 evaluation, J6-8). */
  crawlDelayMs?: number;
}

/**
 * The organization's render-session budget is spent (`QUOTA_EXCEEDED` from
 * the slot reservation): every session is held by another scan. Not an
 * infrastructure failure — the caller waits for a slot or defers the batch
 * to its next link; failing the scan over it discarded everything the scan
 * had fetched (2026-09-18 evaluation, J6-3).
 */
export class RenderCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderCapacityError';
  }
}

/** Whether a slot-reservation failure is the quota refusal (the sessions
 * domain's `SandboxQuotaError`, which the crawl ctx shim passes through
 * as-is) rather than a store or transport fault. */
function isSandboxQuotaRefusal(error: unknown): error is Error {
  return (
    error instanceof Error && 'code' in error && error.code === 'QUOTA_EXCEEDED'
  );
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
  transient: z.boolean().optional(),
});
const renderHaltSchema = z.object({
  reason: z.enum(['egress_proxy', 'browser']),
  error: z.string(),
});
const renderPayloadSchema = z.object({
  pages: z.array(z.unknown()),
  halted: renderHaltSchema.nullish(),
});

/**
 * Map the worker's output file onto per-URL outcomes. A URL the worker never
 * reached (or a malformed record) is `not_attempted` — the row stays due and
 * the next continuation link retries it. A `halted` marker the file carries
 * is handed on as it is; a malformed one reads as no halt.
 */
export function parseRenderResults(
  payload: unknown,
  urls: readonly string[],
): RenderBatchResult {
  const byUrl = new Map<string, RenderPageOutcome>();
  for (const url of urls) byUrl.set(url, { kind: 'not_attempted' });
  const parsed = renderPayloadSchema.safeParse(payload);
  if (!parsed.success) return { outcomes: byUrl, halted: null };
  for (const entry of parsed.data.pages) {
    const record = renderRecordSchema.safeParse(entry);
    if (!record.success) continue;
    const { url, attempted, status, finalUrl, html, error, transient } =
      record.data;
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
      transient: transient === true,
    });
  }
  return { outcomes: byUrl, halted: parsed.data.halted ?? null };
}

/**
 * Render one batch of URLs in a throwaway sandbox session and return the
 * per-URL outcomes, with the worker's halt marker when it stopped early.
 * Throws on any infrastructure failure of its own (see module doc).
 */
export async function renderUrlsInSandbox(
  ctx: ActionCtx,
  args: RenderBatchArgs,
): Promise<RenderBatchResult> {
  const sessionId = sessionIdForRender(args.batchKey);
  let rowId: string;
  try {
    rowId = await ctx.runMutation(
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
  } catch (error) {
    if (isSandboxQuotaRefusal(error)) {
      throw new RenderCapacityError(error.message);
    }
    throw error;
  }

  let created = false;
  try {
    try {
      await sessionCreate({
        sessionId,
        organizationId: args.organizationId,
        profile: 'default',
        // Knowledge crawling is the deployment's own work: renders never
        // leave the server for an organization's device.
        placement: 'server',
      });
      created = true;
    } catch (error) {
      await settleFailedCreate(ctx, { rowId, sessionId, error });
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
      // The site's robots.txt `Crawl-delay` paces the render leg too, not
      // just the probe leg (2026-09-18 evaluation, J6-8).
      crawlDelayMs: args.crawlDelayMs ?? 0,
      // The same identity the probe leg sends (2026-09-15 evaluation, i6).
      userAgent: crawlerUserAgent(process.env.TALE_VERSION),
      // What is the lane's fault, not the page's — one definition, handed
      // in because the worker cannot import it.
      proxyErrorPattern: RENDER_PROXY_ERROR_PATTERN.source,
      crashErrorPattern: RENDER_CRASH_ERROR_PATTERN.source,
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
    const detail = (): string =>
      [`status ${run.status}`, run.errorMessage ?? '', run.stderr.slice(-400)]
        .filter((part) => part.length > 0)
        .join(' — ');
    // The worker rewrites its output after every page, so even a hard-killed
    // exec leaves partial results behind; a MISSING file is an infra failure
    // worth failing the scan over.
    const file = await sessionReadFile(sessionId, '/agent/output/pages.json');
    if (!file) {
      throw new Error(`render worker produced no output (${detail()})`);
    }
    const payload: unknown = JSON.parse(new TextDecoder().decode(file.bytes));
    const result = parseRenderResults(payload, args.urls);
    // So is a file on which no page was even attempted and that names no
    // halt: the worker writes it before it launches the browser, so a
    // Chromium that would not start leaves every URL `not_attempted`. Handed
    // back as-is, the crawl would re-probe and re-render the same batch
    // round after round, a session each, and end hours later blaming its
    // continuation budget.
    if (
      result.halted === null &&
      args.urls.length > 0 &&
      [...result.outcomes.values()].every(
        (outcome) => outcome.kind === 'not_attempted',
      )
    ) {
      throw new Error(
        `sandbox session rendered no page: the render worker stopped before its first one (${detail()})`,
      );
    }
    return result;
  } finally {
    // Only a session this batch created is torn down here. A failed create's
    // row already reads `failed`: settling it `destroyed` would hide it from
    // the watchdog's COLLECT pass, the one pass that reaches what the create
    // may have left behind.
    if (created) {
      try {
        await sessionDestroy(sessionId);
      } catch (error) {
        console.warn(
          `[render] session ${sessionId} destroy failed (teardown cron will reap it):`,
          error instanceof Error ? error.message : error,
        );
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
}

/**
 * Settle the reserved row of a render create that failed: it reads `failed`
 * with `destroyed_at_ms` unset, which frees the batch's slot and leaves the
 * row to the sandbox watchdog's COLLECT pass — the only pass that reaches a
 * `failed` row. A create cut short between Docker's create and start leaves a
 * container in state `created` that the spawner never adopts, and it pins its
 * runtime image through every later deploy until something destroys it.
 *
 * Before the flip, while the still-`creating` row holds the batch's one slot
 * (once it reads `failed`, a second run of the same batch may reserve the id
 * and create, and a later destroy would hit that run's session):
 *  - a DUPLICATE (409) destroys nothing. This create made nothing: the
 *    spawner already holds the id, or is creating it, for another run. The
 *    batch key is deterministic (domain, scan start, link, batch number), so
 *    a link that runs twice (a job retry, or a continuation enqueued twice)
 *    asks for the same id. And the spawner answers a probe with 404 while it
 *    is still creating a session, so the reconcile pass may already have
 *    settled the other run's row while that run renders in the session.
 *    Between its create and its exec that session is idle, so `if_idle`
 *    would not spare it. The COLLECT pass settles this row past its grace:
 *    without a spawner call while a newer or live row carries the id, and
 *    otherwise with the same idle-only destroy.
 *  - any other failure asks the spawner to destroy what it holds under the
 *    id, when idle, as the agent lane does. Best-effort: a busy answer or a
 *    failed destroy is logged and left to the COLLECT pass, and never masks
 *    the create's error.
 */
async function settleFailedCreate(
  ctx: ActionCtx,
  args: { rowId: string; sessionId: string; error: unknown },
): Promise<void> {
  const { rowId, sessionId } = args;
  if (args.error instanceof SessionDuplicateError) {
    console.warn(
      `[render] session ${sessionId} already exists spawner-side; this batch destroys nothing and the watchdog collects its failed row`,
    );
  } else {
    await sessionDestroyIfIdle(sessionId)
      .then(({ busy }) => {
        if (busy)
          console.warn(
            `[render] session ${sessionId} runs an exec after this failed create; the watchdog collects it once idle`,
          );
      })
      .catch((destroyError: unknown) => {
        console.warn(
          `[render] destroy after failed create of ${sessionId} failed (the watchdog collects it):`,
          destroyError instanceof Error ? destroyError.message : destroyError,
        );
      });
  }
  await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
    rowId,
    status: 'failed',
  });
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
 * the original URL and again on the post-redirect landing host. A page's HTML
 * comes back with its CSS layout written in (`RENDERED_LAYOUT_SCRIPT`).
 */
export const RENDER_WORKER_SOURCE = `
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

const UNFINISHED_PAGE_REASON = ${JSON.stringify(RENDER_UNFINISHED_REASON)};

// The page's HTML with its CSS layout written in, so the host's tag-level
// text pass separates what the page shows separated; the plain
// serialization when the page refuses the script.
const LAYOUT_SCRIPT = ${JSON.stringify(RENDERED_LAYOUT_SCRIPT)};
async function renderedHtml(page) {
  const layout = await page.evaluate(LAYOUT_SCRIPT).catch(() => null);
  return typeof layout === 'string' && layout !== '' ? layout : page.content();
}

const input = JSON.parse(readFileSync('/agent/code/urls.json', 'utf8'));
const urls = Array.isArray(input.urls) ? input.urls : [];
const perPageTimeoutMs = input.perPageTimeoutMs || 20000;
const idleTimeoutMs = input.idleTimeoutMs || 5000;
const softBudgetMs = input.softBudgetMs || 180000;
const maxHtmlBytes = input.maxHtmlBytes || 6291456;
const maxTotalBytes = input.maxTotalBytes || 15728640;
const crawlDelayMs = Number(input.crawlDelayMs) || 0;
const userAgent =
  typeof input.userAgent === 'string' && input.userAgent !== ''
    ? input.userAgent
    : undefined;
// The host's one definition of what is the lane's fault, not the page's
// (lib/knowledge/crawl-parse.ts): a proxy refusal halts the batch, a
// browser crash earns the page one retry in a fresh context.
const proxyErrorPattern = compilePattern(input.proxyErrorPattern);
const crashErrorPattern = compilePattern(input.crashErrorPattern);

function compilePattern(source) {
  if (typeof source !== 'string' || source === '') return null;
  try {
    return new RegExp(source, 'i');
  } catch (error) {
    console.warn('render worker: unusable error pattern ' + JSON.stringify(source) + ': ' + errorText(error));
    return null;
  }
}
function errorText(error) {
  return error && error.message ? String(error.message) : 'navigation failed';
}
function failureClass(message) {
  if (proxyErrorPattern && proxyErrorPattern.test(message)) return 'proxy';
  if (crashErrorPattern && crashErrorPattern.test(message)) return 'crash';
  return 'page';
}

const startedAt = Date.now();
const records = new Map();
for (const url of urls) records.set(url, { url, attempted: false });
// Set when the lane itself failed: the host stores what rendered and fails
// the scan for the rest, charging no page.
let halted = null;
mkdirSync('/agent/output', { recursive: true });
// Rewrites the whole output after every page and returns its size in BYTES —
// the budget is what the host reads back (UTF-8, JSON-escaped), never a count
// of UTF-16 code units.
function flush() {
  const pages = Array.from(records.values());
  const serialized = JSON.stringify(halted ? { pages, halted } : { pages });
  writeFileSync('/agent/output/pages.json', serialized);
  return Buffer.byteLength(serialized, 'utf8');
}
// The bytes a page would add to the output: its record serialized with the
// rendered fields, minus the record as it stands (escaping included).
function admissionBytes(record, fields) {
  return (
    Buffer.byteLength(JSON.stringify({ ...record, ...fields }), 'utf8') -
    Buffer.byteLength(JSON.stringify(record), 'utf8')
  );
}
let fileBytes = flush();

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
// The batch's context, under the crawler's own User-Agent (handed in by the
// host: a site owner can name TaleBot in robots.txt and tell its traffic
// apart in their logs). A crash retry replaces it, closing the crashed one
// first, so the browser never carries a broken context on.
let context = null;
async function openContext() {
  const previous = context;
  context = null;
  if (previous) await previous.close().catch(() => {});
  context = await browser.newContext(userAgent ? { userAgent } : {});
}

// One navigation. \`ok\` carries the rendered document. A failure carries the
// browser's words and their class: \`page\` (this page's own — a non-2xx, a
// blocked redirect, an oversized DOM, a load timeout), \`crash\` (the browser
// lost the navigation), \`proxy\` (the egress proxy refused the tunnel) or
// \`browser\` (no page could be opened at all).
async function renderOnce(url) {
  let page;
  try {
    page = await context.newPage();
  } catch (error) {
    return { ok: false, cls: 'browser', error: errorText(error) };
  }
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
    // A document whose body broke off after its headers (the browser's
    // network service died mid-download) parses as a page — a shell with a
    // few words that would be stored as the content. The request knows.
    if (response) {
      await response.finished().catch(() => null);
      const failure = response.request().failure();
      if (failure) {
        return {
          ok: false,
          cls: 'crash',
          error: 'document download broke off: ' + (failure.errorText || 'unknown cause'),
        };
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
      return { ok: false, cls: 'page', error: 'redirected to a blocked host' };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, cls: 'page', status, error: 'HTTP ' + status + ' at render time' };
    }
    const html = await renderedHtml(page);
    if (Buffer.byteLength(html, 'utf8') > maxHtmlBytes) {
      return { ok: false, cls: 'page', error: 'rendered HTML exceeds the per-page bound' };
    }
    return { ok: true, status, finalUrl, html };
  } catch (error) {
    const message = errorText(error);
    return { ok: false, cls: failureClass(message), error: message };
  } finally {
    await page.close().catch(() => {});
  }
}

let budgetExhausted = false;
try {
  await openContext();
  let renderedOne = false;
  for (const url of urls) {
    if (Date.now() - startedAt > softBudgetMs) break;
    // The site's Crawl-delay between two page loads (never before the first).
    if (renderedOne && crawlDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, crawlDelayMs));
    }
    renderedOne = true;
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
    // On file until the page settles: a worker killed mid-page (a page that
    // holds the browser past the exec budget) leaves this reason behind, so
    // the host charges the page instead of handing it back to every batch.
    record.error = UNFINISHED_PAGE_REASON;
    fileBytes = flush();
    let result = await renderOnce(url);
    delete record.error;
    if (!result.ok && result.cls === 'crash') {
      // Once more, in a fresh context: a helper process the host killed is
      // back by now. A second loss is the page's row to show, uncharged.
      let reopened = true;
      try {
        await openContext();
      } catch (error) {
        reopened = false;
        result = { ok: false, cls: 'browser', error: errorText(error) };
      }
      if (reopened) {
        const retry = await renderOnce(url);
        result = !retry.ok && retry.cls === 'crash' ? { ...retry, transient: true } : retry;
      }
    }
    if (!result.ok && (result.cls === 'proxy' || result.cls === 'browser')) {
      // The lane, not the page: hand the page back untouched, say why, stop.
      record.attempted = false;
      halted = {
        reason: result.cls === 'proxy' ? 'egress_proxy' : 'browser',
        error: result.error.slice(0, 500),
      };
      flush();
      break;
    }
    if (!result.ok) {
      record.error = result.error.slice(0, 500);
      if (result.status !== undefined) record.status = result.status;
      if (result.transient) record.transient = true;
    } else {
      const fields = { status: result.status, finalUrl: result.finalUrl, html: result.html };
      // Admit the page only while the output stays under the batch cap —
      // decided BEFORE storing, in bytes. A page that does not fit is
      // handed back (not attempted) for the next batch, and this batch
      // ends here.
      if (fileBytes + admissionBytes(record, fields) > maxTotalBytes) {
        record.attempted = false;
        budgetExhausted = true;
      } else {
        Object.assign(record, fields);
      }
    }
    fileBytes = flush();
    if (budgetExhausted) break;
  }
} finally {
  await browser.close().catch(() => {});
}
flush();
`;
