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
 * JSON. The spawner harvests `/user/output/<file>`, POSTs the bytes to a
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
import { renderInSession } from './render_session';

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
 * a URL), then writes the rendered PDF / image bytes to `/user/output/`.
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
    // The one-shot sandbox image bakes Playwright under the Playwright MCP
    // package (NOT on the runner's NODE_PATH), with Chromium at
    // PLAYWRIGHT_BROWSERS_PATH. A bare `require('playwright')` therefore fails
    // with MODULE_NOT_FOUND; resolve it from the baked location, falling back
    // to a normal require for any other runtime.
    'const { chromium } = (() => {',
    "  const baked = '/opt/agents/lib/node_modules/@playwright/mcp';",
    '  try {',
    "    return require(require.resolve('playwright', { paths: [baked] }));",
    '  } catch (e) {',
    "    return require('playwright');",
    '  }',
    '})();',
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
    "    fs.mkdirSync('/user/output', { recursive: true });",
    '    fs.writeFileSync(`/user/output/${SPEC.outputFileName}`, bytes);',
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

  const script = buildRenderScript(request, outputFileName, timeoutMs);
  const renderKey = `crawler-doc-render-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  // Run the render in an ephemeral render session and read the produced file's
  // bytes straight off the session (the render session tears itself down).
  const output = await renderInSession(ctx, {
    organizationId,
    renderKey,
    scriptContent: script,
    outputFileName,
    timeoutMs,
    logTag: 'documents',
  });

  // Unlike the crawl path (which re-parses transient JSON), the produced
  // PDF/image IS the deliverable — persist it and hand the caller its storageId.
  const storageId: Id<'_storage'> = await ctx.storage.store(
    new Blob([output.bytes], { type: output.contentType || contentType }),
  );

  return {
    storageId,
    size: output.size,
    contentType: output.contentType || contentType,
  };
}
