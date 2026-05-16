// Prerender every doc route to a static HTML file under ./dist. Mirrors
// services/web/scripts/prerender.ts but enumerates pages from the content
// tree instead of a hand-maintained list.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEFAULT_DOCS_SITE_URL } from '../lib/site-url';
import { listAllContent } from './walk-content';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DIST = resolve(ROOT, 'dist');
const SSR_BUNDLE = resolve(ROOT, 'dist-ssr', 'entry-server.js');
const SITE_URL = process.env.DOCS_SITE_URL ?? DEFAULT_DOCS_SITE_URL;
// Mount-point prefix passed to the router during SSR so it resolves URLs
// against the same basepath the client uses. Empty for root deployments.
const BASE_PATH = (process.env.DOCS_BASE_URL ?? '/').replace(/\/$/, '');

interface Route {
  url: string;
  title: string;
  description: string;
  noindex?: boolean;
}

function pathFor(locale: string, slug: string): string {
  const cleaned = slug === 'index' ? '' : slug.replace(/\/index$/, '');
  if (locale === 'en') return cleaned ? `/${cleaned}` : '/';
  return cleaned ? `/${locale}/${cleaned}` : `/${locale}`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function injectSeo(template: string, route: Route): string {
  const canonical = `${SITE_URL}${route.url}`;
  return template
    .replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeAttr(route.title)}</title>`,
    )
    .replace(
      /<meta\s+name="description"[^>]*>/,
      `<meta name="description" content="${escapeAttr(route.description)}" />`,
    )
    .replace(
      /<link\s+rel="canonical"[^>]*>/,
      `<link rel="canonical" href="${canonical}" />`,
    )
    .replace(
      /<meta\s+property="og:url"[^>]*>/,
      `<meta property="og:url" content="${canonical}" />`,
    )
    .replace(
      /<meta\s+property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escapeAttr(route.title)}" />`,
    )
    .replace(
      /<meta\s+property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escapeAttr(route.description)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${escapeAttr(route.title)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${escapeAttr(route.description)}" />`,
    );
}

async function main() {
  const template = await readFile(resolve(DIST, 'index.html'), 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const mod = (await import(pathToFileURL(SSR_BUNDLE).href)) as {
    render: (url: string) => Promise<{ html: string }>;
  };

  const records = await listAllContent();
  const routes: Route[] = records.map((record) => ({
    url: pathFor(record.locale, record.slug),
    title:
      typeof record.frontmatter.title === 'string'
        ? `${record.frontmatter.title} | Tale`
        : 'Tale',
    description:
      typeof record.frontmatter.description === 'string'
        ? record.frontmatter.description
        : '',
    noindex: record.frontmatter.noindex === true,
  }));

  // De-duplicate (the locale fallback chain doesn't apply to URLs, only content).
  const seen = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.url)) continue;
    seen.add(route.url);
    process.stdout.write(`prerender ${route.url} ... `);
    const { html } = await mod.render(`${BASE_PATH}${route.url}`);
    const withSeo = injectSeo(template, route);
    const final = withSeo.replace(
      '<div id="root"></div>',
      `<div id="root">${html}</div>`,
    );
    const outPath =
      route.url === '/'
        ? resolve(DIST, 'index.html')
        : resolve(DIST, route.url.slice(1), 'index.html');
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, final, 'utf-8');
    process.stdout.write('done\n');
  }
}

await main();
