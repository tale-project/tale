/**
 * Crawl a built site the way a link checker, a search engine or a language
 * model does: from a few seeds, through every address its prerendered HTML
 * and its text artifacts (`llms.txt`, the sitemap, the per-page Markdown)
 * carry, asking the site's real server. It finds what source-level link
 * checks cannot see — addresses the chrome builds (rail, breadcrumbs,
 * prev/next, footer, alternates), artifacts that list a page the server does
 * not answer, and ids the rendered page lacks.
 *
 * Absolute URLs on the production origin (`https://docs.tale.dev/…`, in the
 * canonical link, the sitemap, `llms.txt`) are followed on the server under
 * test through `aliases`, so they are judged rather than skipped as external.
 */

import { spawn, type ChildProcess } from 'node:child_process';

import { Parser } from 'htmlparser2';

export interface CrawlOptions {
  /** Origin of the server under test (`http://127.0.0.1:52011`). */
  origin: string;
  /** Other origins that mean the same site (the production origin). */
  aliases?: readonly string[];
  /** Site-relative paths the crawl starts from. */
  seeds: readonly string[];
  concurrency?: number;
  /** Stop after this many addresses, so a runaway URL space cannot hang CI. */
  maxUrls?: number;
}

export interface CrawlFinding {
  /** A link answers 4xx/5xx; a page links an address that only redirects;
   *  a `#fragment` names no id on the page it points at. */
  rule: 'broken-link' | 'redirected-link' | 'fragment-missing';
  /** Site-relative address, with the fragment for `fragment-missing`. */
  target: string;
  status?: number;
  location?: string;
  /** Up to five pages that carry the link. */
  from: string[];
}

export interface CrawlReport {
  /** Addresses fetched. */
  fetched: number;
  /** HTML pages among them that answered 200. */
  pages: number;
  /** True when `maxUrls` stopped the crawl before it ran out of links. */
  truncated: boolean;
  findings: CrawlFinding[];
}

interface Reference {
  from: string;
  /** Where the link was found: an HTML page, or a text artifact. */
  source: 'html' | 'text' | 'seed';
  fragment: string;
}

interface Answer {
  status: number;
  location?: string;
  ids?: ReadonlySet<string>;
}

const TEXT_TYPES = /text\/(?:plain|markdown)|application\/xml|text\/xml/;

/** URL-carrying attributes, by element. */
function urlsOf(name: string, attributes: Record<string, string>): string[] {
  const one = (key: string) => (attributes[key] ? [attributes[key]] : []);
  const srcset = (key: string) =>
    (attributes[key] ?? '')
      .split(',')
      .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
      .filter(Boolean);
  switch (name) {
    case 'a':
    case 'area':
    case 'link':
      return one('href');
    case 'img':
    case 'source':
      return [...one('src'), ...srcset('srcset')];
    case 'video':
      return [...one('src'), ...one('poster')];
    case 'audio':
    case 'track':
    case 'script':
    case 'iframe':
    case 'embed':
      return one('src');
    case 'meta': {
      const key = attributes.property ?? attributes.name ?? '';
      return /^(?:og:image|og:url|og:video|twitter:image)$/.test(key)
        ? one('content')
        : [];
    }
    default:
      return [];
  }
}

/**
 * The addresses and ids of a page. Only attributes are read: the URLs in
 * JSON-LD and the hydration payload are data no reader follows.
 */
function readHtml(html: string): { links: string[]; ids: Set<string> } {
  const links: string[] = [];
  const ids = new Set<string>();
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (attributes.id) ids.add(attributes.id);
        if (name === 'a' && attributes.name) ids.add(attributes.name);
        links.push(...urlsOf(name, attributes));
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return { links, ids };
}

/** Links in a Markdown or plain-text artifact, and `<loc>` in a sitemap. */
function readText(text: string): string[] {
  const links = new Set<string>();
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?/g)) {
    if (match[1]) links.add(match[1]);
  }
  for (const match of text.matchAll(/<loc>([^<]+)<\/loc>|\shref="([^"]+)"/g)) {
    const url = (match[1] ?? match[2] ?? '').replace(/&amp;/g, '&');
    if (url) links.add(url);
  }
  return [...links];
}

/** Crawl the site and report every link that does not land. */
export async function crawlSite(options: CrawlOptions): Promise<CrawlReport> {
  const origin = new URL(options.origin).origin;
  const aliases = new Set(
    (options.aliases ?? []).map((alias) => new URL(alias).origin),
  );
  const maxUrls = options.maxUrls ?? 5000;
  const references = new Map<string, Reference[]>();
  const answers = new Map<string, Answer>();
  const queue: string[] = [];
  let truncated = false;

  /** A link as a same-site path (+ fragment), or null when it leaves. */
  const consider = (
    raw: string,
    base: string,
    from: string,
    source: Reference['source'],
  ) => {
    const trimmed = raw.trim();
    if (!trimmed || /^(?:mailto|tel|javascript|data|blob):/i.test(trimmed))
      return;
    let url: URL;
    try {
      url = new URL(trimmed, base);
    } catch {
      return;
    }
    if (url.origin !== origin && !aliases.has(url.origin)) return;
    const fragment = url.hash ? decodeURIComponent(url.hash.slice(1)) : '';
    const path = `${url.pathname}${url.search}`;
    const list = references.get(path) ?? [];
    list.push({ from, source, fragment });
    references.set(path, list);
    if (answers.has(path) || queue.includes(path)) return;
    if (answers.size + queue.length >= maxUrls) {
      truncated = true;
      return;
    }
    queue.push(path);
  };

  const fetchOne = async (path: string) => {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: { 'accept-language': 'en', 'user-agent': 'tale-link-crawl/1' },
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => {
      console.warn(`[crawl] ${path} failed:`, error);
      return null;
    });
    if (!response) {
      answers.set(path, { status: 0 });
      return;
    }
    const type = response.headers.get('content-type') ?? '';
    const answer: Answer = { status: response.status };
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        answer.location = location;
        consider(location, `${origin}${path}`, path, 'seed');
      }
      await response.body?.cancel();
    } else if (response.status === 200 && type.includes('text/html')) {
      const { links, ids } = readHtml(await response.text());
      answer.ids = ids;
      for (const link of links)
        consider(link, `${origin}${path}`, path, 'html');
    } else if (response.status === 200 && TEXT_TYPES.test(type)) {
      for (const link of readText(await response.text())) {
        consider(link, `${origin}${path}`, path, 'text');
      }
    } else {
      await response.body?.cancel();
    }
    answers.set(path, answer);
  };

  for (const seed of options.seeds) consider(seed, origin, 'seed', 'seed');
  const workers = Array.from({ length: options.concurrency ?? 8 }, async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      await fetchOne(next);
    }
  });
  await Promise.all(workers);

  const findings: CrawlFinding[] = [];
  let pages = 0;
  for (const [path, answer] of answers) {
    const list = references.get(path) ?? [];
    const from = (filter: (reference: Reference) => boolean) => [
      ...new Set(list.filter(filter).map((reference) => reference.from)),
    ];
    if (answer.status === 200 && answer.ids) pages += 1;
    if (answer.status === 0 || answer.status >= 400) {
      findings.push({
        rule: 'broken-link',
        target: path,
        status: answer.status,
        from: from(() => true).slice(0, 5),
      });
      continue;
    }
    if (answer.status >= 300 && answer.status < 400) {
      const linking = from((reference) => reference.source === 'html');
      if (linking.length > 0) {
        findings.push({
          rule: 'redirected-link',
          target: path,
          status: answer.status,
          location: answer.location,
          from: linking.slice(0, 5),
        });
      }
      continue;
    }
    if (!answer.ids) continue;
    const missing = new Map<string, Set<string>>();
    for (const reference of list) {
      if (!reference.fragment || answer.ids.has(reference.fragment)) continue;
      const pagesLinking = missing.get(reference.fragment) ?? new Set();
      pagesLinking.add(reference.from);
      missing.set(reference.fragment, pagesLinking);
    }
    for (const [fragment, linking] of missing) {
      findings.push({
        rule: 'fragment-missing',
        target: `${path}#${fragment}`,
        from: [...linking].slice(0, 5),
      });
    }
  }
  return { fetched: answers.size, pages, truncated, findings };
}

export interface SiteServer {
  origin: string;
  stop: () => void;
}

/**
 * Start a built site's own server (`bun server.ts`) on a free port and
 * resolve its origin once it logs `listening on :<port>`.
 */
export function startSiteServer({
  cwd,
  entry = 'server.ts',
  env = {},
  timeoutMs = 30_000,
}: {
  cwd: string;
  entry?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<SiteServer> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn('bun', [entry], {
      cwd,
      env: { ...process.env, ...env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(`${entry} did not start within ${timeoutMs} ms:\n${output}`),
      );
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /listening on :(\d+)/.exec(output);
      if (!match) return;
      clearTimeout(timer);
      resolve({
        origin: `http://127.0.0.1:${match[1]}`,
        stop: () => child.kill(),
      });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${entry} exited with ${code}:\n${output}`));
    });
  });
}
