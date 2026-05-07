// Print each legal route to a static PDF under ./dist/legal/<slug>.pdf
// (and ./dist/<lang>/legal/<slug>.pdf for prefixed locales).
//
// Runs after `prerender.ts`: the prerendered HTML at
// `dist/<route>/index.html` already contains the markdown-rendered
// content, so a headless Chromium navigation produces a PDF that
// matches the on-screen page exactly. Site chrome (header, footer,
// the in-page Download-PDF button) is hidden through the `print:hidden`
// utility — Playwright's `emulateMedia('print')` enables those rules.

import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { file, serve } from 'bun';
import { chromium } from 'playwright';

import { enumerateLegalRoutes } from './legal-routes';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DIST = resolve(ROOT, 'dist');

async function main(): Promise<void> {
  const routes = await enumerateLegalRoutes();
  if (routes.length === 0) {
    process.stdout.write('no legal routes — skipping pdf generation\n');
    return;
  }

  const server = serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const resolved = resolve(DIST, rel);
      if (resolved !== DIST && !resolved.startsWith(`${DIST}/`)) {
        return new Response('forbidden', { status: 403 });
      }
      const direct = file(resolved);
      if (await direct.exists()) return new Response(direct);
      const indexHtml = file(join(resolved, 'index.html'));
      if (await indexHtml.exists()) return new Response(indexHtml);
      return new Response(file(join(DIST, 'index.html')));
    },
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });

    for (const route of routes) {
      process.stdout.write(`pdf ${route.url} ... `);
      await page.goto(`${baseUrl}${route.url}`, {
        waitUntil: 'networkidle',
      });
      const outPath = resolve(DIST, `${route.url.slice(1)}.pdf`);
      await mkdir(dirname(outPath), { recursive: true });
      await page.pdf({
        path: outPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });
      process.stdout.write('done\n');
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

await main();
