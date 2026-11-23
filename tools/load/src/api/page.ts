/**
 * A browser opening a page of the app: the document, then each file the
 * document names that a browser fetches to show it (its scripts, style
 * sheets, module preloads, the manifest and the icons), then the modules
 * those scripts import, statically, as far as the imports go. Each file is
 * fetched once per browser (`cache`): the app's files are named by their
 * content, and a browser keeps them. At most `parallel` requests are open at
 * once, six by default, as a browser spreads them over a host's
 * connections.
 *
 * What it leaves out: the modules the app imports on demand once it runs (a
 * screen's own code, a locale's messages). Which of them a screen needs is
 * decided by running the app, and this does not run it.
 */

import type { Requester } from './client.ts';

export interface PageVisit {
  /** The document, and every file fetched for it. */
  requests: number;
  /** Characters of the bodies, decoded. */
  chars: number;
  /** What failed, one line each. */
  failures: string[];
}

export interface VisitOptions {
  /** The deployment's address; a path prefix is kept. */
  baseUrl: string;
  /** The files this browser holds already, by path. */
  cache: Set<string>;
  /** Requests open at once. Default 6. */
  parallel?: number;
  /** The document's metric name (`GET /dashboard/:id`). */
  name: string;
  /** Redirects followed before the document counts as failed. Default 5. */
  maxRedirects?: number;
}

/** `<link rel>` tokens whose target a browser fetches as the page loads. */
const FETCHED_RELS: ReadonlySet<string> = new Set([
  'stylesheet',
  'modulepreload',
  'preload',
  'icon',
  'apple-touch-icon',
  'manifest',
]);

const TAG = /<(script|link|base)\b([^>]*)>/gi;
const ATTRIBUTE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
/** A module's static imports and re-exports: `import "./a.js"`,
 * `import {b} from "./b.js"`, `export * from "/c.js"`; never `import()`. */
const STATIC_IMPORT =
  /(?:\bimport|\bfrom)\s*["'`]((?:\.{1,2})?\/[^"'`\s]+)["'`]/g;

function attributes(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? '').toLowerCase();
    found.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

/** The URLs a document names that a browser fetches to show it, resolved
 * against the document (or its `<base href>`). */
export function documentFiles(html: string, documentUrl: string): string[] {
  let base = documentUrl;
  const files: string[] = [];
  for (const match of html.matchAll(TAG)) {
    const tag = (match[1] ?? '').toLowerCase();
    const attrs = attributes(match[2] ?? '');
    if (tag === 'base') {
      const href = attrs.get('href');
      if (href !== undefined && href !== '') {
        base = new URL(href, documentUrl).href;
      }
      continue;
    }
    if (tag === 'script') {
      const src = attrs.get('src');
      if (src !== undefined && src !== '' && !attrs.has('nomodule')) {
        files.push(new URL(src, base).href);
      }
      continue;
    }
    const href = attrs.get('href');
    const rels = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (
      href !== undefined &&
      href !== '' &&
      rels.some((rel) => FETCHED_RELS.has(rel)) &&
      !rels.includes('alternate')
    ) {
      files.push(new URL(href, base).href);
    }
  }
  return [...new Set(files)];
}

/** The modules a script imports statically, resolved against it. */
export function staticImports(source: string, moduleUrl: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(STATIC_IMPORT)) {
    const specifier = match[1];
    if (specifier !== undefined) found.add(new URL(specifier, moduleUrl).href);
  }
  return [...found];
}

function isScript(path: string, contentType: string | undefined): boolean {
  return (
    /\.m?js(?:$|\?)/.test(path) || (contentType ?? '').includes('javascript')
  );
}

/** A file's metric name: one per kind, not per file. */
function fileName(path: string): string {
  return path.includes('/assets/') ? 'GET /assets/:file' : 'GET /:file';
}

/** Run `work` over `items`, `parallel` at a time. */
async function inPool<T>(
  items: readonly T[],
  parallel: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(parallel, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next] as T;
        next += 1;
        await work(item);
      }
    },
  );
  await Promise.all(lanes);
}

/** Open `path` as a browser does: the document, its files, their imports. */
export async function visitPage(
  requester: Requester,
  path: string,
  options: VisitOptions,
): Promise<PageVisit> {
  const base = new URL(options.baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  /** The path below the base URL a same-origin URL names, or null. */
  const below = (url: string): string | null => {
    const parsed = new URL(url);
    if (parsed.origin !== base.origin) return null;
    const full = `${parsed.pathname}${parsed.search}`;
    if (prefix === '') return full;
    return full.startsWith(`${prefix}/`) ? full.slice(prefix.length) : null;
  };
  const visit: PageVisit = { requests: 0, chars: 0, failures: [] };
  const parallel = options.parallel ?? 6;

  let current = path;
  let html: string | null = null;
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop += 1) {
    const response = await requester.request({
      method: 'GET',
      path: current,
      name: hop === 0 ? options.name : `${options.name} (redirected)`,
      headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      expect: [200, 301, 302, 303, 307, 308],
    });
    visit.requests += 1;
    visit.chars += response.text.length;
    const location = response.header('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = below(
        new URL(location, `${base.origin}${prefix}${current}`).href,
      );
      if (next === null) {
        visit.failures.push(`${current}: redirected away to ${location}`);
        return visit;
      }
      current = next;
      continue;
    }
    if (response.status !== 200) {
      visit.failures.push(`${current}: HTTP ${response.status}`);
      return visit;
    }
    html = response.text;
    break;
  }
  if (html === null) {
    visit.failures.push(`${path}: more redirects than a browser follows`);
    return visit;
  }

  let wave = documentFiles(html, `${base.origin}${prefix}${current}`);
  while (wave.length > 0) {
    const fresh: string[] = [];
    for (const url of wave) {
      const file = below(url);
      if (file === null || options.cache.has(file)) continue;
      options.cache.add(file);
      fresh.push(file);
    }
    const imported: string[] = [];
    await inPool(fresh, parallel, async (file) => {
      const response = await requester.request({
        method: 'GET',
        path: file,
        name: fileName(file),
        headers: { accept: '*/*' },
      });
      visit.requests += 1;
      visit.chars += response.text.length;
      if (!response.ok) {
        visit.failures.push(`${file}: HTTP ${response.status}`);
        return;
      }
      if (isScript(file, response.header('content-type'))) {
        imported.push(
          ...staticImports(response.text, `${base.origin}${prefix}${file}`),
        );
      }
    });
    wave = imported;
  }
  return visit;
}
