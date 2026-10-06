/**
 * Pin what a cold load of the built app preloads: the entry's static import
 * closure, which `dist/index.html` lists as `<link rel="modulepreload">`.
 *
 * Runs after `vite build` next to `check-sw-manifest.ts`. The sign-in page
 * once preloaded 2.6 MB gzip of JavaScript because the entry reached the
 * whole CodeMirror stack through Vite's dynamic-import helper (2026-09-26
 * evaluation, G-08). Editors belong behind a dynamic import; a chunk of
 * theirs back in the preload list fails the build so the regression is
 * caught here, not in the next evaluation. KaTeX (which the streaming
 * markdown renderer loads for the first reply with math), the flow canvas
 * and the libraries only some pages use are held to the same rule: each
 * route's code loads with its route (`ENTRY_ROUTES` in `vite.config.ts`), and
 * a static import from the entry would bring one back to every page.
 *
 * Usage (from `services/platform`): `bun scripts/check-entry-budget.ts [dist]`
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Vendor chunks that must never be in the cold-load preload set. */
export const FORBIDDEN_PRELOADS = [
  'vendor-codemirror',
  'vendor-katex',
  'vendor-flow',
];

/**
 * Packages no preloaded chunk may carry, whatever chunk they land in: the
 * charts (recharts has no chunk of its own; its dependencies are the
 * entry's too), the flow canvas, KaTeX, and what single pages need: zip
 * files (skill uploads, document previews), the automation engine's schema
 * validation and YAML (the MCP settings page), cron schedules (automations),
 * the table library (list pages), the HTML sanitizer (diagrams, previews,
 * email).
 * Read from the chunks' source maps, so a static import that pulls one into
 * the entry fails the build.
 */
export const FORBIDDEN_PACKAGES = [
  'recharts',
  '@xyflow/react',
  'katex',
  'jszip',
  'ajv',
  'yaml',
  'cron-parser',
  '@tanstack/table-core',
  'dompurify',
];

/**
 * The service's own catalogs no preloaded chunk may carry, from its root, a
 * path ending in `/` naming every file under it: a session reads one
 * language, and German and French load when one first needs them
 * (`lib/i18n/i18n.ts`).
 */
export const FORBIDDEN_SOURCES = ['messages/de/', 'messages/fr/'];

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

/** The forbidden packages a source map's `sources` name, each once. */
export function forbiddenPackagesIn(sources: readonly string[]): string[] {
  return FORBIDDEN_PACKAGES.filter((name) =>
    sources.some((source) => source.includes(`node_modules/${name}/`)),
  );
}

/**
 * The forbidden sources a source map names: its `sources` resolve from the
 * map's folder, the forbidden paths from the service root.
 */
export function forbiddenSourcesIn(
  sources: readonly string[],
  mapDir: string,
  serviceRoot: string,
): string[] {
  const named = sources.map((source) => resolve(mapDir, source));
  return FORBIDDEN_SOURCES.filter((path) => {
    const forbidden = resolve(serviceRoot, path);
    return path.endsWith('/')
      ? named.some((source) => source.startsWith(`${forbidden}/`))
      : named.includes(forbidden);
  });
}

/**
 * Every preloaded chunk that carries a forbidden package or source, with
 * what it carries.
 */
export function findForbiddenContent(dist: string, urls: string[]): string[] {
  const found: string[] = [];
  for (const url of urls) {
    const mapPath = resolve(dist, `${url}.map`);
    if (!existsSync(mapPath)) continue;
    const map = JSON.parse(readFileSync(mapPath, 'utf8')) as {
      sources?: string[];
    };
    const sources = map.sources ?? [];
    for (const name of [
      ...forbiddenPackagesIn(sources),
      ...forbiddenSourcesIn(sources, dirname(mapPath), resolve(dist, '..')),
    ]) {
      found.push(`${url} (${name})`);
    }
  }
  return found;
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
  const forbidden = [
    ...findForbiddenPreloads(urls),
    ...findForbiddenContent(dist, urls),
  ];
  const total = gzipTotal(dist, urls);
  console.log(
    `Cold-load JS: ${urls.length} preloaded modules, ${(total / 1024).toFixed(0)} KB gzip`,
  );
  if (forbidden.length > 0) {
    console.error(
      'Chunks that must stay behind a dynamic import are preloaded:',
    );
    for (const url of forbidden) console.error(`  - ${url}`);
    process.exit(1);
  }
}
