// Prerender every doc route to a static HTML file under ./dist. Mirrors
// services/web/scripts/prerender.ts but enumerates pages from the content
// tree instead of a hand-maintained list.
//
// Each route's `<head>` is captured from the page's own `useDocumentMeta`
// during SSR (see `app/entry-server.tsx` + `@tale/ui/seo` HeadSink), so the
// prerendered head matches the live page exactly — including robots, hreflang
// alternates, and Article/Breadcrumb JSON-LD, which the old regex injector
// dropped.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { listAllContent } from './walk-content';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DIST = resolve(ROOT, 'dist');
const SSR_BUNDLE = resolve(ROOT, 'dist-ssr', 'entry-server.js');
// Mount-point prefix passed to the router during SSR so it resolves URLs
// against the same basepath the client uses. Empty for root deployments.
const BASE_PATH = (process.env.DOCS_BASE_URL ?? '/').replace(/\/$/, '');

interface Route {
  url: string;
  locale: string;
}

function pathFor(locale: string, slug: string): string {
  const cleaned = slug === 'index' ? '' : slug.replace(/\/index$/, '');
  if (locale === 'en') return cleaned ? `/${cleaned}` : '/';
  return cleaned ? `/${locale}/${cleaned}` : `/${locale}`;
}

/** Replace the seo:start/seo:end block with the route's captured `<head>`. */
function injectHead(template: string, head: string): string {
  return template.replace(
    /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,
    () => `<!-- seo:start -->\n    ${head}\n    <!-- seo:end -->`,
  );
}

function injectBody(template: string, html: string): string {
  return template.replace(
    '<div id="root"></div>',
    () => `<div id="root">${html}</div>`,
  );
}

function setHtmlLang(template: string, locale: string): string {
  return template.replace(/<html lang="[^"]*"/, () => `<html lang="${locale}"`);
}

async function main() {
  const started = Date.now();
  const template = await readFile(resolve(DIST, 'index.html'), 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const mod = (await import(pathToFileURL(SSR_BUNDLE).href)) as {
    render: (url: string) => Promise<{ html: string; head: string }>;
  };

  const records = await listAllContent();
  const routes: Route[] = records.map((record) => ({
    url: pathFor(record.locale, record.slug),
    locale: record.locale,
  }));

  // De-duplicate (the locale fallback chain doesn't apply to URLs, only content).
  const seen = new Set<string>();
  process.stdout.write(`prerendering up to ${routes.length} routes...\n`);
  for (const route of routes) {
    if (seen.has(route.url)) continue;
    seen.add(route.url);
    process.stdout.write(`prerender ${route.url} ... `);

    const { html, head } = await mod.render(`${BASE_PATH}${route.url}`);
    const final = setHtmlLang(
      injectBody(injectHead(template, head), html),
      route.locale,
    );

    const outPath =
      route.url === '/'
        ? resolve(DIST, 'index.html')
        : resolve(DIST, route.url.slice(1), 'index.html');
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, final, 'utf-8');
    process.stdout.write('done\n');
  }

  process.stdout.write(
    `prerendered ${seen.size} routes in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  );
}

await main();
