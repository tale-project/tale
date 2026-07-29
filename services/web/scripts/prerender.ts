// Prerender each marketing route (× locale) to a static HTML file under
// ./dist. Runs after `vite build` (client) and `vite build --ssr` (server
// entry).
//
// Each route's `index.html` embeds the rendered markup inside
// `<div id="root">…</div>` and the route's real `<head>` — captured from the
// page's own `useDocumentMeta` during SSR (see `app/entry-server.tsx` +
// `@tale/ui/seo` HeadSink). The prerendered head is therefore identical to
// what the live page renders; there is no separate hand-maintained meta list.
// Search engines and previews get fully-formed, localized HTML; users boot
// the same JS bundle and hydrate on top.

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { localizedPath, type SupportedLocale } from '../lib/i18n/locales';
import { MARKETING_ROUTES } from '../lib/seo/marketing-routes';
import { enumerateLegalRoutes } from './legal-routes';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DIST = resolve(ROOT, 'dist');
const SSR_BUNDLE = resolve(ROOT, 'dist-ssr', 'entry-server.js');

// English (root, no prefix) + the URL-prefixed locales. Marketing pages reuse
// one component tree across all three; the SSR entry aligns i18n to the URL.
const BASE_LOCALES: readonly SupportedLocale[] = ['en', 'de', 'fr'];

interface PrerenderRoute {
  url: string;
  locale: SupportedLocale;
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

function collectRoutes(legalUrls: PrerenderRoute[]): PrerenderRoute[] {
  const marketing: PrerenderRoute[] = [];
  for (const locale of BASE_LOCALES) {
    for (const route of MARKETING_ROUTES) {
      marketing.push({ url: localizedPath(locale, route.url), locale });
    }
  }
  // The 404 artifact (English; the client re-localizes after mount). The
  // static server returns it with a real 404 status for unknown paths —
  // deliberately outside MARKETING_ROUTES so it never enters the sitemap
  // or llms.txt.
  const notFound: PrerenderRoute = { url: '/404', locale: 'en' };
  return [...marketing, notFound, ...legalUrls];
}

async function main(): Promise<void> {
  const started = Date.now();
  const template = await Bun.file(resolve(DIST, 'index.html')).text();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const mod = (await import(pathToFileURL(SSR_BUNDLE).href)) as {
    render: (url: string) => Promise<{ html: string; head: string }>;
  };

  const legalUrls: PrerenderRoute[] = (await enumerateLegalRoutes()).map(
    (route) => ({ url: route.url, locale: route.locale }),
  );
  const routes = collectRoutes(legalUrls);

  const seen = new Set<string>();
  process.stdout.write(`prerendering up to ${routes.length} routes...\n`);

  for (const route of routes) {
    if (seen.has(route.url)) continue;
    seen.add(route.url);
    process.stdout.write(`prerender ${route.url} ... `);

    const { html, head } = await mod.render(route.url);
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

  process.stdout.write(
    `prerendered ${seen.size} routes in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  );
}

await main();
