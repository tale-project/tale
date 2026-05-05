// Prerender each marketing route to a static HTML file under ./dist.
// Runs after `vite build` (client) and `vite build --ssr` (server entry).
//
// The output preserves SPA hydration: each route's index.html embeds the
// rendered markup inside `<div id="root">…</div>` plus per-route SEO meta,
// so search engines and previews see fully-formed HTML while users still
// boot the same JS bundle on top.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DIST = resolve(ROOT, 'dist');
const SSR_BUNDLE = resolve(ROOT, 'dist-ssr', 'entry-server.js');

interface RouteSeo {
  url: string;
  title: string;
  description: string;
}

const ROUTES: RouteSeo[] = [
  {
    url: '/',
    title: 'Tale: The Sovereign AI Platform',
    description:
      'Self-hosted AI platform for data-sensitive organizations — local AI models, agents, and automations on your own infrastructure. ISO 27001 & SOC 2 certified.',
  },
  {
    url: '/pricing',
    title: 'Pricing — Simple, Transparent Pricing | Tale',
    description:
      'One price for your entire team — no per-seat fees, no hidden costs. Community, Pro, and Enterprise plans for self-hosted AI in production.',
  },
  {
    url: '/hardware-pricing',
    title: 'Hardware Pricing | Tale',
    description:
      'High-performance AI hardware — priced right. Run state-of-the-art models, anywhere. Quality, Hybrid, and Speed configurations available.',
  },
  {
    url: '/contact',
    title: 'Contact us | Tale',
    description:
      'Get in touch with the Tale team. Connect with one of our domain experts to discuss your goals and find the best AI solution for your organization.',
  },
  {
    url: '/request-demo',
    title: 'Request a demo | Tale',
    description:
      'We help data-sensitive organizations automate workflows with private, reliable AI. Connect with a domain expert to explore solutions for your business.',
  },
];

const SITE_URL = 'https://tale.dev';

function injectSeo(template: string, route: RouteSeo): string {
  const canonical = `${SITE_URL}${route.url === '/' ? '/' : route.url}`;
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`)
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

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main(): Promise<void> {
  const template = await readFile(resolve(DIST, 'index.html'), 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const mod = (await import(pathToFileURL(SSR_BUNDLE).href)) as {
    render: (url: string) => Promise<{ html: string }>;
  };

  for (const route of ROUTES) {
    process.stdout.write(`prerender ${route.url} ... `);
    const { html } = await mod.render(route.url);
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
