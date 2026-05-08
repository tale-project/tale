// Build-time: emit /llms.txt, /llms-full.txt, /sitemap.xml, /robots.txt,
// and per-legal-page <slug>.md files for the marketing site. Mirrors the
// docs site's build pipeline so both surfaces ship the same SEO + LLM
// artifacts. Runs after `vite build` but before/alongside prerender.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLlmsFullTxt } from '@tale/webui/llm/build-llms-full-txt';
import { buildLlmsTxt } from '@tale/webui/llm/build-llms-txt';
import { pageAsMarkdown } from '@tale/webui/llm/page-as-markdown';
import { buildRobotsTxt } from '@tale/webui/seo/build-robots';
import { buildSitemap, type SitemapPage } from '@tale/webui/seo/build-sitemap';

import { enumerateLegalRoutes } from './legal-routes';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DIST = resolve(ROOT, 'dist');
const SITE_URL = 'https://tale.dev';

interface MarketingRoute {
  url: string;
  title: string;
  description: string;
  /** True for legal pages — they get noindex + a /<slug>.md export. */
  isLegal?: boolean;
}

const STATIC_ROUTES: MarketingRoute[] = [
  {
    url: '/',
    title: 'Tale: The Sovereign AI Platform',
    description:
      'Self-hosted AI platform for data-sensitive organisations — local AI models, agents, and automations on your own infrastructure.',
  },
  {
    url: '/pricing',
    title: 'Pricing',
    description:
      'One price for your entire team — no per-seat fees, no hidden costs.',
  },
  {
    url: '/hardware-pricing',
    title: 'Hardware pricing',
    description:
      'High-performance AI hardware — Quality, Hybrid, and Speed configurations.',
  },
  {
    url: '/contact',
    title: 'Contact',
    description: 'Get in touch with the Tale team.',
  },
  {
    url: '/request-demo',
    title: 'Request a demo',
    description:
      'Talk with a domain expert about your use case for sovereign AI.',
  },
];

async function main() {
  const legal = await enumerateLegalRoutes();
  await mkdir(DIST, { recursive: true });

  // --- /llms.txt ---------------------------------------------------------
  const llmsTxt = buildLlmsTxt({
    siteTitle: 'Tale',
    siteDescription:
      'Tale — the sovereign AI platform for data-sensitive organisations. Self-hosted, on your own infrastructure.',
    sections: [
      {
        heading: 'Pages',
        pages: STATIC_ROUTES.map((r) => ({
          title: r.title,
          url: `${SITE_URL}${r.url === '/' ? '/index.md' : `${r.url}.md`}`,
          description: r.description,
        })),
      },
      {
        heading: 'Legal',
        pages: legal
          .filter((r) => r.locale === 'en')
          .map((r) => ({
            title: r.title,
            url: `${SITE_URL}${r.url}.md`,
            description: r.description,
          })),
      },
    ],
    optional: [
      { title: 'Documentation', url: 'https://docs.tale.dev/llms.txt' },
      { title: 'GitHub', url: 'https://github.com/tale-project/tale' },
    ],
  });
  await writeFile(resolve(DIST, 'llms.txt'), llmsTxt);
  process.stdout.write('built llms.txt\n');

  // --- /llms-full.txt (concat of static + legal markdown bodies) ---------
  const fullPages: { title: string; url: string; body: string }[] = [];
  for (const route of STATIC_ROUTES) {
    fullPages.push({
      title: route.title,
      url: `${SITE_URL}${route.url}`,
      body: `${route.title}\n\n${route.description}\n`,
    });
  }
  for (const route of legal.filter((entry) => entry.locale === 'en')) {
    const path = resolve(
      ROOT,
      'app',
      'content',
      'legal',
      'en',
      `${route.slug}.md`,
    );
    const raw = await readFile(path, 'utf-8');
    const body = stripFrontmatter(raw);
    fullPages.push({
      title: route.title,
      url: `${SITE_URL}${route.url}`,
      body,
    });
  }
  await writeFile(resolve(DIST, 'llms-full.txt'), buildLlmsFullTxt(fullPages));
  process.stdout.write('built llms-full.txt\n');

  // --- /sitemap.xml with hreflang per legal page -------------------------
  const sitemapPages: SitemapPage[] = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.url}`,
  }));
  const legalBySlug = new Map<string, typeof legal>();
  for (const r of legal) {
    const list = legalBySlug.get(r.slug) ?? ([] as typeof legal);
    list.push(r);
    legalBySlug.set(r.slug, list);
  }
  for (const [, variants] of legalBySlug) {
    const alternates: Partial<Record<string, string>> = {};
    for (const v of variants) alternates[v.locale] = `${SITE_URL}${v.url}`;
    alternates['x-default'] = alternates.en;
    for (const v of variants) {
      sitemapPages.push({ url: `${SITE_URL}${v.url}`, alternates });
    }
  }
  await writeFile(resolve(DIST, 'sitemap.xml'), buildSitemap(sitemapPages));
  process.stdout.write('built sitemap.xml\n');

  // --- /robots.txt -------------------------------------------------------
  const robots = buildRobotsTxt({
    sitemaps: [`${SITE_URL}/sitemap.xml`, `https://docs.tale.dev/sitemap.xml`],
  });
  await writeFile(resolve(DIST, 'robots.txt'), robots);
  process.stdout.write('built robots.txt\n');

  // --- per-legal-page .md endpoints --------------------------------------
  for (const r of legal) {
    const path = resolve(
      ROOT,
      'app',
      'content',
      'legal',
      r.locale,
      `${r.slug}.md`,
    );
    const raw = await readFile(path, 'utf-8');
    const body = stripFrontmatter(raw);
    const out = resolve(DIST, `${r.url.replace(/^\//, '')}.md`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(
      out,
      pageAsMarkdown({
        frontmatter: { title: r.title, description: r.description },
        body,
        siteUrl: SITE_URL,
      }),
    );
  }
  process.stdout.write(`built ${legal.length} per-legal-page .md endpoints\n`);
}

function stripFrontmatter(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  return match ? match[1] : raw;
}

await main();
