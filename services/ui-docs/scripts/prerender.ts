// Prerender every route to a static HTML file under ./dist. Each route's
// `<head>` is captured from the page's own `useDocumentMeta` during SSR (see
// `app/entry-server.tsx` + the `@tale/ui/seo` HeadSink), so the prerendered
// head matches the live page exactly — including robots and JSON-LD.

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { listAllContent } from './walk-content';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DIST = resolve(ROOT, 'dist');
const SSR_BUNDLE = resolve(ROOT, 'dist-ssr', 'entry-server.js');
// Mount-point prefix passed to the router during SSR so it resolves URLs
// against the same basepath the client uses. Empty for root deployments.
const BASE_PATH = (process.env.UI_DOCS_BASE_URL ?? '/').replace(/\/$/, '');

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

async function main() {
  const started = Date.now();
  const template = await Bun.file(resolve(DIST, 'index.html')).text();
  const mod = (await import(pathToFileURL(SSR_BUNDLE).href)) as {
    render: (url: string) => Promise<{ html: string; head: string }>;
  };

  const records = await listAllContent();
  // The marketing front page plus one route per content page. `/404` is
  // rendered separately so it never enters the sitemap.
  const routes = ['/', ...records.map((record) => `/docs/${record.slug}`)];

  process.stdout.write(`prerendering ${routes.length} routes...\n`);
  for (const route of routes) {
    process.stdout.write(`prerender ${route} ... `);
    const { html, head } = await mod.render(`${BASE_PATH}${route}`);
    const final = injectBody(injectHead(template, head), html);
    const outPath =
      route === '/'
        ? resolve(DIST, 'index.html')
        : resolve(DIST, route.slice(1), 'index.html');
    await Bun.write(outPath, final);
    process.stdout.write('done\n');
  }

  // Prerendered 404 artifact. The shared React server serves
  // `dist/404/index.html` with a real 404 status.
  process.stdout.write('prerender /404 ... ');
  {
    const { html, head } = await mod.render(`${BASE_PATH}/404`);
    await Bun.write(
      resolve(DIST, '404', 'index.html'),
      injectBody(injectHead(template, head), html),
    );
  }
  process.stdout.write('done\n');

  process.stdout.write(
    `prerendered ${routes.length + 1} routes in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  );
}

await main();
