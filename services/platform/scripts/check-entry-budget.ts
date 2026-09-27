/**
 * Pin what a cold load of the built app preloads: the entry's static import
 * closure, which `dist/index.html` lists as `<link rel="modulepreload">`.
 *
 * Runs after `vite build` next to `check-sw-manifest.ts`. The sign-in page
 * once preloaded 2.6 MB gzip of JavaScript because the entry reached the
 * whole CodeMirror stack through Vite's dynamic-import helper (2026-09-26
 * evaluation, G-08). Editors belong behind a dynamic import; a chunk of
 * theirs back in the preload list fails the build so the regression is
 * caught here, not in the next evaluation. KaTeX is still reached statically
 * through the markdown renderer (`packages/ui/src/markdown/markdown.tsx`);
 * it is reported, and joins the failures once that import is lazy.
 *
 * Usage (from `services/platform`): `bun scripts/check-entry-budget.ts [dist]`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Vendor chunks that must never be in the cold-load preload set. */
export const FORBIDDEN_PRELOADS = ['vendor-codemirror'];
/** Vendor chunks that should leave the preload set — reported, not fatal yet. */
export const WATCHED_PRELOADS = ['vendor-katex'];

/**
 * The module scripts and modulepreloads of a built index.html, in document
 * order, each once (the entry may be listed as both).
 */
export function parsePreloadedScripts(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(
    /<(?:script[^>]*\btype="module"[^>]*\bsrc|link[^>]*\brel="modulepreload"[^>]*\bhref)="([^"]+)"/g,
  )) {
    const url = match[1];
    if (url !== undefined) urls.add(url.replace(/^\.?\//, ''));
  }
  return [...urls];
}

function matching(urls: string[], names: string[]): string[] {
  return urls.filter((url) => names.some((name) => url.includes(`/${name}-`)));
}

/** Every forbidden chunk in the preload set; empty when the budget holds. */
export function findForbiddenPreloads(urls: string[]): string[] {
  return matching(urls, FORBIDDEN_PRELOADS);
}

/** Every watched chunk still in the preload set. */
export function findWatchedPreloads(urls: string[]): string[] {
  return matching(urls, WATCHED_PRELOADS);
}

export function gzipTotal(dist: string, urls: string[]): number {
  let total = 0;
  for (const url of urls) {
    total += gzipSync(readFileSync(resolve(dist, url))).length;
  }
  return total;
}

if (import.meta.main) {
  const dist = resolve(process.argv[2] ?? 'dist');
  const urls = parsePreloadedScripts(
    readFileSync(resolve(dist, 'index.html'), 'utf8'),
  );
  if (urls.length === 0) {
    console.error(`No module scripts found in ${dist}/index.html`);
    process.exit(1);
  }
  const forbidden = findForbiddenPreloads(urls);
  const total = gzipTotal(dist, urls);
  console.log(
    `Cold-load JS: ${urls.length} preloaded modules, ${(total / 1024).toFixed(0)} KB gzip`,
  );
  for (const url of findWatchedPreloads(urls)) {
    console.warn(`  still preloaded, should become lazy: ${url}`);
  }
  if (forbidden.length > 0) {
    console.error(
      'Chunks that must stay behind a dynamic import are preloaded:',
    );
    for (const url of forbidden) console.error(`  - ${url}`);
    process.exit(1);
  }
}
