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
 * The code editor is held to a budget of its own: what its lazy view chunk
 * loads beyond the cold load (`LAZY_BUDGETS`) — the editor's packages and
 * nothing more, no other language's grammar, no code built from strings.
 *
 * Usage (from `services/platform`): `bun scripts/check-entry-budget.ts [dist]`
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
 * entry's too), the flow canvas and its layout engine (elkjs: its worker
 * file and the main-thread build load with the first canvas), KaTeX, and
 * what single pages need: zip
 * files (skill uploads, document previews), the automation engine's schema
 * validation and YAML (the MCP settings page), its expression parser and
 * scope analysis (the automation editor and the run dialogs), cron schedules
 * (automations), the table library (list pages), the HTML sanitizer
 * (diagrams, previews, email).
 * Read from the chunks' source maps, so a static import that pulls one into
 * the entry fails the build.
 */
export const FORBIDDEN_PACKAGES = [
  // The code editor: its view and the syntax trees load with the first
  // code field, and the languages only the message editor's code blocks
  // read load with a block in that language.
  '@codemirror/view',
  '@lezer/common',
  '@codemirror/lang-html',
  '@codemirror/legacy-modes',
  '@codemirror/language-data',
  'recharts',
  '@xyflow/react',
  'elkjs',
  'katex',
  'jszip',
  'ajv',
  'yaml',
  'acorn',
  'periscopic',
  'cron-parser',
  '@tanstack/table-core',
  'dompurify',
];

/**
 * The service's own catalogs no preloaded chunk may carry, from its root, a
 * path ending in `/` naming every file under it: a session reads one
 * language, and German, French and the Swiss overrides load per topic as a
 * session in them first needs one (`lib/i18n/i18n.ts`). English rides with
 * the modules that read it, so the largest topics the first pages do not
 * read stay with the pages that do.
 */
export const FORBIDDEN_SOURCES = [
  'messages/de/',
  'messages/fr/',
  'messages/de-CH/',
  'messages/en/settings.yml',
  'messages/en/governance.yml',
  'messages/en/documents.yml',
  'messages/en/projects.yml',
];

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

/** Which of `names` a source map's `sources` name, each once. */
function packagesIn(
  sources: readonly string[],
  names: readonly string[],
): string[] {
  return names.filter((name) =>
    sources.some((source) => source.includes(`node_modules/${name}/`)),
  );
}

/** The forbidden packages a source map's `sources` name, each once. */
export function forbiddenPackagesIn(sources: readonly string[]): string[] {
  return packagesIn(sources, FORBIDDEN_PACKAGES);
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

/** A lazy chunk whose static closure is held to a size and a content. */
export interface LazyBudget {
  /** The chunk's name, as the build prefixes its file (`code-editor-view-…`). */
  name: string;
  /** Gzip bytes it may load beyond the cold load. */
  maxGzip: number;
  /** Packages none of its chunks may carry. */
  packages: readonly string[];
  /** Text none of its chunks may hold. */
  text: readonly string[];
}

export const LAZY_BUDGETS: readonly LazyBudget[] = [
  {
    // The code editor: CodeMirror's core, its JavaScript, JSON and YAML
    // grammars, and the view module.
    name: 'code-editor-view',
    maxGzip: 230 * 1024,
    // Languages only the message editor's code blocks read, and the table
    // that imports every one of them.
    packages: [
      '@codemirror/lang-html',
      '@codemirror/lang-css',
      '@codemirror/legacy-modes',
      '@codemirror/language-data',
    ],
    // The production CSP has no `unsafe-eval`.
    text: ['eval(', 'new Function('],
  },
];

/**
 * The chunks a built chunk imports statically (`import … from "./x.js"`,
 * `import "./x.js"`, `export … from "./x.js"`), as paths from `dist`; a
 * dynamic `import("./x.js")` loads later and is not one of them.
 */
export function staticImportsOf(source: string, url: string): string[] {
  const dir = dirname(url);
  const found = new Set<string>();
  for (const match of source.matchAll(
    /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g,
  )) {
    const path = match[1];
    if (path !== undefined) found.add(join(dir, path));
  }
  return [...found];
}

/** `start` and every chunk it imports statically, each once, `start` first. */
export function staticClosure(
  start: string,
  read: (url: string) => string,
): string[] {
  const seen = new Set<string>([start]);
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const url of staticImportsOf(read(next), next)) {
      if (seen.has(url)) continue;
      seen.add(url);
      queue.push(url);
    }
  }
  return [...seen];
}

/** The chunks that load `url` with a dynamic `import()`. */
export function dynamicImportersOf(
  url: string,
  files: readonly string[],
  read: (url: string) => string,
): string[] {
  const name = url.slice(url.lastIndexOf('/') + 1);
  const forms = ['`', "'", '"'].map(
    (quote) => `import(${quote}./${name}${quote})`,
  );
  return files.filter((file) => {
    if (file === url) return false;
    const text = read(file);
    return forms.some((form) => text.includes(form));
  });
}

/** What a lazy chunk loads beyond the cold load, and what is wrong with it. */
export interface LazyReport {
  name: string;
  /** Its chunks that neither the cold load nor the chunks importing it
   *  have already loaded. */
  chunks: string[];
  gzip: number;
  problems: string[];
}

/**
 * Hold one lazy chunk to its budget: the chunks its static closure adds to
 * what is loaded by the time it is asked for — the cold load (`preloaded`)
 * and whatever every chunk that imports it brings — their gzip size, the
 * packages their source maps name and the text they hold.
 */
export function checkLazyChunk(
  dist: string,
  preloaded: readonly string[],
  budget: LazyBudget,
): LazyReport {
  const files = readdirSync(resolve(dist, 'assets'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => `assets/${file}`);
  const start = files.filter((file) =>
    file.startsWith(`assets/${budget.name}-`),
  );
  const [first] = start;
  if (first === undefined || start.length > 1) {
    return {
      name: budget.name,
      chunks: [],
      gzip: 0,
      problems: [
        first === undefined
          ? `no ${budget.name} chunk was built`
          : `more than one ${budget.name} chunk: ${start.join(', ')}`,
      ],
    };
  }
  const read = (url: string) => readFileSync(resolve(dist, url), 'utf8');
  // Loaded already, whichever chunk asks for it: what every importer
  // needs before it can.
  const importerClosures = dynamicImportersOf(first, files, read).map(
    (importer) => new Set(staticClosure(importer, read)),
  );
  const [firstClosure, ...otherClosures] = importerClosures;
  const loaded = new Set(
    [...(firstClosure ?? [])].filter((url) =>
      otherClosures.every((closure) => closure.has(url)),
    ),
  );
  const chunks = staticClosure(first, read).filter(
    (url) => !preloaded.includes(url) && !loaded.has(url),
  );
  const gzip = gzipTotal(dist, chunks);
  const problems: string[] = [];
  if (gzip > budget.maxGzip) {
    problems.push(
      `${(gzip / 1024).toFixed(0)} KB gzip, over its ${(budget.maxGzip / 1024).toFixed(0)} KB`,
    );
  }
  for (const url of chunks) {
    const text = read(url);
    for (const needle of budget.text) {
      if (text.includes(needle)) problems.push(`${url} holds ${needle}`);
    }
    const mapPath = resolve(dist, `${url}.map`);
    if (!existsSync(mapPath)) continue;
    const map = JSON.parse(readFileSync(mapPath, 'utf8')) as {
      sources?: string[];
    };
    for (const name of packagesIn(map.sources ?? [], budget.packages)) {
      problems.push(`${url} carries ${name}`);
    }
  }
  return { name: budget.name, chunks, gzip, problems };
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
  let failed = false;
  if (forbidden.length > 0) {
    console.error(
      'Chunks that must stay behind a dynamic import are preloaded:',
    );
    for (const url of forbidden) console.error(`  - ${url}`);
    failed = true;
  }
  for (const budget of LAZY_BUDGETS) {
    const report = checkLazyChunk(dist, urls, budget);
    console.log(
      `Lazy ${report.name}: ${report.chunks.length} chunks beyond what loads it, ${(report.gzip / 1024).toFixed(0)} KB gzip (budget ${(budget.maxGzip / 1024).toFixed(0)} KB)`,
    );
    for (const url of report.chunks) {
      const size = gzipTotal(dist, [url]);
      console.log(`  ${url} ${(size / 1024).toFixed(1)} KB`);
    }
    if (report.problems.length > 0) {
      console.error(`${report.name} is over its budget:`);
      for (const problem of report.problems) console.error(`  - ${problem}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}
