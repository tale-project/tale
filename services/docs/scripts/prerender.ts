// Prerender every doc route to a static HTML file under ./dist. Mirrors
// services/web/scripts/prerender.ts but enumerates pages from the content
// tree instead of a hand-maintained list.
//
// Each route's `<head>` is captured from the page's own `useDocumentMeta`
// during SSR (see `app/entry-server.tsx` + `@tale/ui/seo` HeadSink), so the
// prerendered head matches the live page exactly — including robots, hreflang
// alternates, and Article/Breadcrumb JSON-LD, which the old regex injector
// dropped.

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expandRedirects } from '../lib/redirects';
import { docsSiteUrl } from '../lib/seo/build';
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

/**
 * Static stub for a moved page (`docs/redirects.json`). Keeps old URLs
 * working on plain static hosting where the Bun server's 301s don't run:
 * the meta refresh navigates, canonical + robots keep crawlers on the new
 * URL, and the anchor covers clients with refresh disabled.
 */
function redirectStub(locale: string, toUrl: string): string {
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="refresh" content="0;url=${toUrl}" />
    <link rel="canonical" href="${toUrl}" />
    <meta name="robots" content="noindex" />
    <title>Redirecting…</title>
  </head>
  <body>
    <p>This page has moved to <a href="${toUrl}">${toUrl}</a>.</p>
  </body>
</html>
`;
}

/**
 * Write one redirect stub per (redirect entry × locale) at the OLD path,
 * same dist layout as prerendered routes. `prerendered` is the set of
 * route URLs the content loop wrote — a redirect source that is still a
 * real page would overwrite it, so it is skipped loudly instead
 * (`tests/redirects.test.ts` fails the suite on the same conflict).
 */
async function writeRedirectStubs(prerendered: Set<string>): Promise<void> {
  const siteUrl = docsSiteUrl();
  let written = 0;
  for (const redirect of expandRedirects()) {
    if (prerendered.has(redirect.from)) {
      console.warn(
        `redirect source ${redirect.from} is still a prerendered page — skipping stub (fix docs/redirects.json)`,
      );
      continue;
    }
    const outPath = resolve(DIST, redirect.from.slice(1), 'index.html');
    await Bun.write(
      outPath,
      redirectStub(redirect.locale, `${siteUrl}${redirect.to}`),
    );
    written += 1;
  }
  if (written > 0) {
    process.stdout.write(`wrote ${written} redirect stubs\n`);
  }
}

async function main() {
  const started = Date.now();
  const template = await Bun.file(resolve(DIST, 'index.html')).text();
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
    await Bun.write(outPath, final);
    process.stdout.write('done\n');
  }

  await writeRedirectStubs(seen);

  // Prerendered 404 artifact (English shell; the client re-localizes after
  // mount). Outside the content walk so it never enters the sitemap. The
  // shared React server serves `dist/404/index.html` with a real 404 status.
  process.stdout.write('prerender /404 ... ');
  {
    const { html, head } = await mod.render(`${BASE_PATH}/404`);
    const final = setHtmlLang(
      injectBody(injectHead(template, head), html),
      'en',
    );
    const outPath = resolve(DIST, '404', 'index.html');
    await Bun.write(outPath, final);
  }
  process.stdout.write('done\n');

  process.stdout.write(
    `prerendered ${seen.size + 1} routes in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  );
}

await main();
