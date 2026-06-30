'use node';

/**
 * Headless page render delegated to the sandbox spawner (Playwright/Chromium).
 *
 * The Python crawler used crawl4ai (headless Chromium via Playwright) to fetch
 * AND JS-render every page. In the platform-internal architecture there is no
 * Chromium inside the Convex Node runtime, so JS rendering is DELEGATED to
 * `services/sandbox-runtime`, which ships Chromium + Playwright pre-baked in its
 * execution image (`PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`, installed in
 * the sandbox-runtime Dockerfile). The spawner has no dedicated "browse"
 * endpoint — it is a code-execution service (`POST /v1/execute`, SSE; see
 * `convex/node_only/sandbox/helpers/spawner_client.ts`). Rendering is therefore
 * expressed as a tiny Playwright Node script dispatched as the spawner's
 * `entryPath`, whose harvested output file carries the rendered HTML back into
 * Convex storage; we read it back with `ctx.storage.get(storageId)`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASSUMPTIONS / TODO(verify) — this seam has NOT been exercised against a live
 * spawner + Convex storage stack. The dispatch contract below is derived purely
 * from reading `spawner_client.ts` (the `SpawnerExecuteBody`/`SpawnerExecuteResponse`
 * shapes) and the real caller `convex/node_only/sandbox/internal_actions.ts`
 * (`executeCode`). Specifically:
 *
 *   1. The render script is staged the same way `executeCode` stages user code:
 *      uploaded to Convex storage via `ctx.storage.store`, then handed to the
 *      spawner as an internal http(s) URL (`ctx.storage.getUrl` +
 *      `toSandboxStorageUrl`). A `data:` URL is NOT usable — the spawner's
 *      input-fetch layer caps `files[].url` at 4096 chars and requires an
 *      http(s) scheme (services/sandbox validate-request.ts). The transient
 *      script blob is deleted best-effort once the spawner has run it.
 *
 *   2. // TODO(verify): we deliberately do NOT reserve a `run_code` audit row
 *      (`internal.sandbox.internal_mutations.reserveSlotAndInsert`) or register
 *      output files in `fileMetadata`/`threadFiles`. A crawler render is an
 *      internal infra fetch, not a user code-run, so polluting the user's
 *      run_code audit list + quota would be wrong. The trade-off: crawler
 *      renders are NOT counted against the org's sandbox quota and produce a
 *      transient storage blob that is deleted immediately after read-back
 *      (best-effort, below). Confirm with the platform owner whether crawler
 *      renders should instead flow through the audited `executeCode` path.
 *
 *   3. // TODO(verify): `outputUrlEndpoint` / `reportUploadedEndpoint` are
 *      computed identically to `executeCode`. They are HMAC-signed callbacks the
 *      spawner POSTs to for extra slots / upload receipts. With a single
 *      pre-allocated slot and a single output file they should never be hit, but
 *      they are required body fields, so we pass them through.
 *
 *   4. // TODO(verify): Chromium launch flags. `--no-sandbox` is included
 *      because the spawner container may run without the kernel privileges
 *      Chromium's own sandbox needs; whether the sandbox-runtime image already
 *      grants them (making the flag unnecessary / undesirable) is UNVERIFIED.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { GenericActionCtx } from 'convex/server';

import type { DataModel, Id } from '../../_generated/dataModel';
import {
  SANDBOX_CONVEX_STORAGE_BASE_DEFAULT,
  toSandboxStorageUrl,
} from '../../lib/helpers/public_storage_url';
import { spawnerExecute } from '../../node_only/sandbox/helpers/spawner_client';

/**
 * Minimal context a sandbox render needs: an action `ctx` (for storage slot
 * minting + read-back) and the owning org for the spawner audit/quota context.
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

/** Compute the spawner upload-callback endpoints (mirrors `executeCode`). */
function resolveCallbackEndpoints(): {
  outputUrlEndpoint: string;
  reportUploadedEndpoint: string;
} {
  const storageBase = (
    process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL ??
    SANDBOX_CONVEX_STORAGE_BASE_DEFAULT
  ).replace(/\/$/, '');
  const httpApiBase = (
    process.env.SANDBOX_HTTP_API_BASE_URL ??
    storageBase.replace(/:3210(\/|$)/, ':3211$1')
  ).replace(/\/$/, '');
  return {
    outputUrlEndpoint: `${httpApiBase}/api/sandbox/output_upload_url`,
    reportUploadedEndpoint: `${httpApiBase}/api/sandbox/record_uploaded`,
  };
}

/**
 * Build the Playwright render script. It navigates to `url`, waits for the
 * network to settle, and writes the rendered HTML + final URL to
 * `/workspace/output/page.json` (the spawner harvests `/workspace/output/`).
 *
 * The script is intentionally self-contained — `require('playwright')` resolves
 * against the sandbox-runtime image's pre-baked install.
 */
function buildRenderScript(
  url: string,
  userAgent: string,
  timeoutMs: number,
): string {
  return [
    "const { chromium } = require('playwright');",
    "const fs = require('fs');",
    '(async () => {',
    // TODO(verify): see header note 4 — `--no-sandbox` may be unnecessary.
    "  const browser = await chromium.launch({ args: ['--no-sandbox'] });",
    '  try {',
    `    const page = await browser.newPage({ userAgent: ${JSON.stringify(userAgent)} });`,
    `    const response = await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle', timeout: ${timeoutMs} });`,
    '    const html = await page.content();',
    '    const finalUrl = page.url();',
    '    const status = response ? response.status() : 0;',
    "    fs.mkdirSync('/workspace/output', { recursive: true });",
    "    fs.writeFileSync('/workspace/output/page.json', JSON.stringify({ url: finalUrl, html, status }));",
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
 * Render `url` in the sandbox spawner via Playwright and return the HTML.
 *
 * Throws on any spawner failure (unreachable, non-completed status, missing
 * output, malformed payload). Callers fall back to a plain fetch.
 */
export async function renderUrlInSandbox(
  renderCtx: SandboxRenderContext,
  url: string,
  options: { timeoutMs?: number; userAgent?: string } = {},
): Promise<SandboxRenderResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const userAgent =
    options.userAgent ??
    'Mozilla/5.0 (compatible; TaleCrawler/1.0; +https://tale.dev)';

  const { ctx, organizationId } = renderCtx;

  // Mint one output upload slot — the spawner POSTs the harvested HTML blob
  // here and reports back the Convex storageId it landed in.
  const rawUploadUrl = await ctx.storage.generateUploadUrl();
  const slotUrl = toSandboxStorageUrl(rawUploadUrl);

  const script = buildRenderScript(url, userAgent, timeoutMs);
  // Stage the render script as a Convex storage blob and hand the spawner an
  // internal http(s) URL. The spawner's input-fetch layer requires every
  // `files[].url` to be an http(s) URL ≤4096 chars (services/sandbox
  // validate-request.ts), so a `data:` URL is not usable. Mirrors the proven
  // executeCode staging path.
  const scriptStorageId = await ctx.storage.store(
    new Blob([script], { type: 'text/javascript' }),
  );
  const rawScriptUrl = await ctx.storage.getUrl(scriptStorageId);
  if (!rawScriptUrl) {
    throw new Error('failed to mint render-script storage url');
  }
  const scriptUrl = toSandboxStorageUrl(rawScriptUrl);

  const { outputUrlEndpoint, reportUploadedEndpoint } =
    resolveCallbackEndpoints();

  // Use a synthetic execution id — we do not reserve a run_code audit row
  // (header note 2). The spawner only needs a unique, opaque id for its own
  // per-run bookkeeping / cancellation key.
  const executionId = `crawler-render-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const spawnerResult = await spawnerExecute(
      {
        executionId,
        organizationId,
        language: 'node',
        files: [{ path: 'render.js', url: scriptUrl }],
        entryPath: 'render.js',
        outputUploadSlots: [{ url: slotUrl }],
        outputUrlEndpoint,
        reportUploadedEndpoint,
        timeoutMs,
      },
      // The spawner client applies its own fetch-timeout margin on top of this.
      AbortSignal.timeout(timeoutMs + 120_000),
    );

    if (spawnerResult.status !== 'completed') {
      const code = spawnerResult.errorCode
        ? `, code=${spawnerResult.errorCode}`
        : '';
      const message = spawnerResult.errorMessage
        ? `: ${spawnerResult.errorMessage}`
        : '';
      throw new Error(
        `sandbox render did not complete (status=${spawnerResult.status}${code}${message})`,
      );
    }

    const outputFile = spawnerResult.outputFiles.find(
      (f) => f.name === 'page.json',
    );
    if (!outputFile) {
      throw new Error('sandbox render produced no page.json output file');
    }

    // The spawner storageId is a `_storage` id minted by `generateUploadUrl`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- spawner storageId is branded at the wire layer; mirrors executeCode in internal_actions.ts
    const storageId = outputFile.storageId as unknown as Id<'_storage'>;

    let html: string;
    let finalUrl = url;
    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob) {
        throw new Error('rendered output blob not found in storage');
      }
      const text = await blob.text();
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object') {
        throw new Error('rendered output payload is not an object');
      }
      const htmlVal = Reflect.get(parsed, 'html');
      const urlVal = Reflect.get(parsed, 'url');
      if (typeof htmlVal !== 'string') {
        throw new Error('rendered output payload has no html string');
      }
      html = htmlVal;
      if (typeof urlVal === 'string' && urlVal.length > 0) {
        finalUrl = urlVal;
      }
    } finally {
      // Best-effort cleanup of the transient render blob — it has served its
      // purpose once read back. A leaked blob is harmless but wasteful.
      try {
        await ctx.storage.delete(storageId);
      } catch (err) {
        console.warn(
          `[crawler] failed to delete transient render blob ${String(storageId)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { url: finalUrl, html };
  } finally {
    // Best-effort cleanup of the transient render-script blob — it has served
    // its purpose once the spawner has fetched and run it.
    try {
      await ctx.storage.delete(scriptStorageId);
    } catch (err) {
      console.warn(
        `[crawler] failed to delete transient render-script blob ${String(
          scriptStorageId,
        )}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
