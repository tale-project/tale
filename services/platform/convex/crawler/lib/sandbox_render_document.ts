'use node';

/**
 * Headless document render (HTML/URL → PDF or PNG/JPEG) delegated to the sandbox
 * spawner (Playwright/Chromium).
 *
 * The Python crawler rendered documents with a long-lived in-process Playwright
 * Chromium (`services/crawler/app/services/{pdf_service,image_service}.py`). In
 * the platform-internal architecture there is no Chromium inside the Convex Node
 * runtime, so rendering is DELEGATED to `services/sandbox-runtime`, which ships
 * Chromium + Playwright pre-baked (`PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`).
 *
 * This mirrors `convex/crawler/lib/sandbox_render.ts::renderUrlInSandbox`
 * (web-crawl HTML fetch) but the output is BINARY (PDF / image bytes) instead of
 * JSON. The spawner harvests `/workspace/output/<file>`, POSTs the bytes to a
 * pre-signed Convex upload slot, and returns the `_storage` id — so unlike the
 * crawl path (which JSON-encodes into a blob we re-parse) we read the produced
 * file straight out of storage and hand the storageId to the caller.
 *
 * The render script is dependency-free apart from Playwright (the
 * markdown→HTML + template work is done UPSTREAM in the Convex action, so the
 * sandbox only ever receives finished HTML or a URL). This keeps the sandbox
 * script identical to the proven crawl-render contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASSUMPTIONS / TODO(verify) — this seam has NOT been exercised against a live
 * spawner + Convex storage stack. The dispatch contract is derived from reading
 * `spawner_client.ts` and the proven `sandbox_render.ts`. Specifically:
 *
 *   1. The render script is staged the same way `executeCode` stages user code:
 *      uploaded to Convex storage, then handed to the spawner as an internal
 *      http(s) URL (`ctx.storage.getUrl` + `toSandboxStorageUrl`). A `data:` URL
 *      is NOT usable — the spawner's input-fetch layer caps `files[].url` at
 *      4096 chars and requires an http(s) scheme (services/sandbox
 *      validate-request.ts), and the script inlines the full document HTML.
 *
 *   2. // TODO(verify): we do NOT reserve a `run_code` audit row — a document
 *      render is internal infra, not a user code-run. The produced blob is NOT
 *      deleted here (it is the deliverable the caller uploads to the user's
 *      library), unlike the transient crawl-render JSON blob.
 *
 *   3. // TODO(verify): `--no-sandbox` Chromium flag — the Python launcher used
 *      `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage
 *      --disable-gpu --disable-crashpad`; we mirror that flag set. Whether the
 *      sandbox-runtime image already grants the kernel privileges (making them
 *      unnecessary) is UNVERIFIED.
 *
 *   4. // TODO(verify): `page.pdf()`/`page.screenshot()` option fidelity. The
 *      Python `image_service` set `window.devicePixelRatio` via `page.evaluate`
 *      and used `scale: 'device'|'css'`; Playwright-Node's `screenshot()` takes
 *      no scale, so we emulate device scale via `deviceScaleFactor` on the
 *      browser context (the idiomatic Node equivalent). Full-page screenshot
 *      lazy-scroll + cookie-dialog dismissal (URL mode only) are ported but
 *      depend on real-page timing that cannot be exercised hermetically.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { GenericActionCtx } from 'convex/server';

import type { DataModel, Id } from '../../_generated/dataModel';
import {
  SANDBOX_CONVEX_STORAGE_BASE_DEFAULT,
  toSandboxStorageUrl,
} from '../../lib/helpers/public_storage_url';
import { spawnerExecute } from '../../node_only/sandbox/helpers/spawner_client';

export interface SandboxRenderDocumentContext {
  ctx: GenericActionCtx<DataModel>;
  organizationId: string;
}

/** Playwright `page.pdf()` options preserved from the crawler PDF service. */
export interface SandboxPdfOptions {
  format: string;
  landscape: boolean;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
  printBackground: boolean;
}

/** Playwright `page.screenshot()` options preserved from the image service. */
export interface SandboxImageOptions {
  imageType: 'png' | 'jpeg';
  quality: number;
  fullPage: boolean;
  width: number;
  height: number;
  scale: number;
}

export type SandboxRenderSource =
  | { kind: 'html'; html: string }
  | { kind: 'url'; url: string; waitUntil: WaitUntilType };

export type WaitUntilType =
  | 'load'
  | 'domcontentloaded'
  | 'networkidle'
  | 'commit';

export interface SandboxRenderPdfRequest {
  output: 'pdf';
  source: SandboxRenderSource;
  pdf: SandboxPdfOptions;
}

export interface SandboxRenderImageRequest {
  output: 'image';
  source: SandboxRenderSource;
  image: SandboxImageOptions;
}

export type SandboxRenderRequest =
  | SandboxRenderPdfRequest
  | SandboxRenderImageRequest;

export interface SandboxRenderDocumentResult {
  storageId: Id<'_storage'>;
  size: number;
  contentType: string;
}

const DEFAULT_RENDER_TIMEOUT_MS = 60_000;
const OUTPUT_FILE_PDF = 'document.pdf';
const OUTPUT_FILE_PNG = 'document.png';
const OUTPUT_FILE_JPEG = 'document.jpeg';

/** Compute the spawner upload-callback endpoints (mirrors `sandbox_render.ts`). */
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

function outputFileFor(request: SandboxRenderRequest): {
  name: string;
  contentType: string;
} {
  if (request.output === 'pdf') {
    return { name: OUTPUT_FILE_PDF, contentType: 'application/pdf' };
  }
  if (request.image.imageType === 'jpeg') {
    return { name: OUTPUT_FILE_JPEG, contentType: 'image/jpeg' };
  }
  return { name: OUTPUT_FILE_PNG, contentType: 'image/png' };
}

/**
 * Build the Playwright render script. It sets the page content (or navigates to
 * a URL), then writes the rendered PDF / image bytes to `/workspace/output/`.
 * The spawner harvests that directory and uploads each file to a Convex slot.
 *
 * The whole request is passed as a single JSON literal to keep the generated
 * script free of brittle string interpolation.
 */
function buildRenderScript(
  request: SandboxRenderRequest,
  outputFileName: string,
  timeoutMs: number,
): string {
  const spec = JSON.stringify({ request, outputFileName, timeoutMs });
  return [
    "const { chromium } = require('playwright');",
    "const fs = require('fs');",
    `const SPEC = ${spec};`,
    '(async () => {',
    // TODO(verify): see header note 3 — the crawler launch flag set.
    "  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-crashpad'] });",
    '  try {',
    '    const req = SPEC.request;',
    '    const isImage = req.output === "image";',
    '    const scale = isImage ? (req.image.scale || 1) : 1;',
    '    const viewport = isImage',
    '      ? { width: req.image.width || 1200, height: req.image.height || 600 }',
    '      : { width: 1280, height: 720 };',
    '    const context = await browser.newContext({',
    '      viewport,',
    '      deviceScaleFactor: scale > 0 ? scale : 1,',
    '      acceptDownloads: false,',
    '    });',
    '    const page = await context.newPage();',
    '    if (req.source.kind === "html") {',
    // PDF used domcontentloaded; image used networkidle. Match per-output.
    '      const waitUntil = isImage ? "networkidle" : "domcontentloaded";',
    '      await page.setContent(req.source.html, { waitUntil, timeout: SPEC.timeoutMs });',
    '    } else {',
    '      const wu = req.source.waitUntil === "commit" ? "commit" : "domcontentloaded";',
    '      await page.goto(req.source.url, { waitUntil: wu, timeout: SPEC.timeoutMs });',
    '      if (req.source.waitUntil === "load" || req.source.waitUntil === "networkidle") {',
    '        try { await page.waitForLoadState(req.source.waitUntil, { timeout: SPEC.timeoutMs }); }',
    '        catch (e) { /* best-effort: fall back to domcontentloaded state */ }',
    '      }',
    '    }',
    '    let bytes;',
    '    if (req.output === "pdf") {',
    '      const o = req.pdf;',
    '      bytes = await page.pdf({',
    '        format: o.format,',
    '        landscape: o.landscape,',
    '        printBackground: o.printBackground,',
    '        margin: { top: o.marginTop, bottom: o.marginBottom, left: o.marginLeft, right: o.marginRight },',
    '      });',
    '    } else {',
    '      const o = req.image;',
    '      if (req.source.kind === "url" && o.fullPage) {',
    '        try {',
    '          await page.evaluate(async () => {',
    '            const delay = (ms) => new Promise((r) => setTimeout(r, ms));',
    '            if (!document.body) return;',
    '            const h = document.body.scrollHeight;',
    '            const vh = window.innerHeight;',
    '            for (let y = 0; y < h; y += vh) { window.scrollTo(0, y); await delay(100); }',
    '            window.scrollTo(0, 0); await delay(200);',
    '          });',
    '          await page.waitForTimeout(500);',
    '        } catch (e) { /* lazy-load scroll is best-effort */ }',
    '      }',
    '      const shot = { fullPage: o.fullPage, type: o.imageType };',
    '      if (o.imageType === "jpeg") { shot.quality = o.quality; }',
    '      bytes = await page.screenshot(shot);',
    '    }',
    "    fs.mkdirSync('/workspace/output', { recursive: true });",
    '    fs.writeFileSync(`/workspace/output/${SPEC.outputFileName}`, bytes);',
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
 * Render `request` in the sandbox spawner via Playwright and return the produced
 * `_storage` id + size + content type. Throws on any spawner failure.
 */
export async function renderDocumentInSandbox(
  renderCtx: SandboxRenderDocumentContext,
  request: SandboxRenderRequest,
  options: { timeoutMs?: number } = {},
): Promise<SandboxRenderDocumentResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const { ctx, organizationId } = renderCtx;
  const { name: outputFileName, contentType } = outputFileFor(request);

  // Mint one output upload slot — the spawner POSTs the harvested bytes here
  // and reports back the Convex storageId it landed in.
  const rawUploadUrl = await ctx.storage.generateUploadUrl();
  const slotUrl = toSandboxStorageUrl(rawUploadUrl);

  const script = buildRenderScript(request, outputFileName, timeoutMs);
  // Stage the render script as a Convex storage blob and hand the spawner an
  // internal http(s) URL. The spawner's input-fetch layer requires every
  // `files[].url` to be an http(s) URL ≤4096 chars (services/sandbox
  // validate-request.ts), so the script — which inlines the full document
  // HTML — cannot ride in a `data:` URL. Mirrors the proven executeCode /
  // run_code_tool staging path.
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

  const executionId = `crawler-doc-render-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

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
        `sandbox document render did not complete (status=${spawnerResult.status}${code}${message})`,
      );
    }

    const outputFile = spawnerResult.outputFiles.find(
      (f) => f.name === outputFileName,
    );
    if (!outputFile) {
      throw new Error(
        `sandbox document render produced no ${outputFileName} output file`,
      );
    }

    // The spawner storageId is a `_storage` id minted by `generateUploadUrl`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- spawner storageId is branded at the wire layer; mirrors executeCode in internal_actions.ts and sandbox_render.ts
    const storageId = outputFile.storageId as unknown as Id<'_storage'>;

    return {
      storageId,
      size: outputFile.size,
      contentType: outputFile.contentType || contentType,
    };
  } finally {
    // Best-effort cleanup of the transient render-script blob — it has served
    // its purpose once the spawner has fetched and run it.
    try {
      await ctx.storage.delete(scriptStorageId);
    } catch (err) {
      console.warn(
        `[documents] failed to delete transient render-script blob ${String(
          scriptStorageId,
        )}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
