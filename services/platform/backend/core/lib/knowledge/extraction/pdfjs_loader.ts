'use node';

/**
 * The single safe entry point for loading pdfjs-dist inside a Convex 'use node'
 * action. Every pdfjs importer MUST go through this — never
 * `import('pdfjs-dist/...')` directly.
 *
 * pdfjs's setup runs ONCE per process, at module-evaluation time on first
 * import, and is then cached process-wide (ESM caches evaluation, including
 * failures). That setup (a) polyfills `DOMMatrix`/`ImageData`/`Path2D` via
 * `require("@napi-rs/canvas")` — a NATIVE module Convex does NOT ship to the
 * bundled action runtime — and (b) constructs `new DOMMatrix()` at top level.
 * With no native canvas and no pre-installed global, that top-level
 * construction throws `ReferenceError: DOMMatrix is not defined` and the whole
 * pdfjs import rejects for the lifetime of the process.
 *
 * Because the first importer wins, a single pdfjs consumer that skips the
 * polyfill poisons the cached module for every other consumer in the same
 * process (e.g. in-process metadata extraction running before RAG text
 * extraction). Routing all consumers through this loader — which installs the
 * pure-JS DOM polyfills and pre-loads the worker BEFORE the first import —
 * guarantees pdfjs always evaluates in a working state regardless of which
 * action reaches it first.
 */

import { installPdfjsDomGlobals } from './pdfjs_dom_polyfill';

export type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsModulePromise: Promise<PdfjsModule> | undefined;

/**
 * Lazily load pdfjs with the DOM globals and fake worker it needs in the Convex
 * node-action runtime. Lazy so this never runs during Convex's module *analyze*
 * pass (where the globals are undefined and a top-level pdfjs import would
 * throw). pdfjs is bundled (tree-shaken) rather than externalized to keep the
 * module upload under the backend's size limit.
 */
export function loadPdfjs(): Promise<PdfjsModule> {
  installPdfjsDomGlobals();
  return (pdfjsModulePromise ??= (async () => {
    // pdfjs's fake worker would dynamically `import('./pdf.worker.mjs')` at
    // getDocument time — a sibling file that doesn't exist in the action
    // bundle, so it fails with "Setting up fake worker failed". Pre-load the
    // worker module and expose it as `globalThis.pdfjsWorker`: pdfjs's
    // PDFWorker._setupFakeWorkerGlobal then uses its `WorkerMessageHandler`
    // in-process and skips the file import. The worker is bundled with the
    // action because we import it statically here.
    // The modern build (package root), not `legacy/`: both work on the Node
    // ≥22 runtime, but the legacy build embeds ~400 core-js polyfill modules
    // that count against Convex's pushed-module size cap.
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs');
    (globalThis as Record<string, unknown>).pdfjsWorker = worker;
    return import('pdfjs-dist');
  })());
}
