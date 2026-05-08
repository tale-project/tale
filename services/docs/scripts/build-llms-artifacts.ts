// Build-time: emit /llms.txt, /llms-full.txt, /sitemap.xml, /robots.txt,
// and per-page <slug>.md files. Writing to `public/` rather than `dist/`
// means the vite dev server serves them automatically (no post-build
// step needed for local development) and `vite build` copies them into
// the production bundle as part of its standard public-directory copy.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLlmsFullTxt } from '@tale/webui/llm/build-llms-full-txt';
import { buildLlmsTxt, type LlmsTxtPage } from '@tale/webui/llm/build-llms-txt';
import { pageAsMarkdown } from '@tale/webui/llm/page-as-markdown';
import { buildRobotsTxt } from '@tale/webui/seo/build-robots';
import { buildSitemap, type SitemapPage } from '@tale/webui/seo/build-sitemap';

import { listAllContent } from './walk-content';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(SCRIPT_DIR, '..', 'public');
const SITE_URL = process.env.DOCS_SITE_URL ?? 'https://docs.tale.dev';
const BASE_LOCALES = ['en', 'de', 'fr'] as const;

function pathFor(locale: string, slug: string): string {
  const cleaned = slug === 'index' ? '' : slug.replace(/\/index$/, '');
  if (locale === 'en') return cleaned ? `/${cleaned}` : '/';
  return cleaned ? `/${locale}/${cleaned}` : `/${locale}`;
}

function urlFor(locale: string, slug: string): string {
  return `${SITE_URL}${pathFor(locale, slug)}`;
}

function mdPathFor(locale: string, slug: string): string {
  const path = pathFor(locale, slug);
  return path === '/' ? '/index.md' : `${path}.md`;
}

async function main() {
  const records = await listAllContent();
  const byLocale = new Map<string, typeof records>();
  for (const r of records) {
    const list = byLocale.get(r.locale) ?? [];
    list.push(r);
    byLocale.set(r.locale, list);
  }

  await mkdir(OUT_DIR, { recursive: true });

  // --- /llms.txt (English-only index, alphabetised by URL) -----------------
  const enPages = (byLocale.get('en') ?? [])
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const sectionMap = new Map<string, LlmsTxtPage[]>();
  for (const page of enPages) {
    const section = sectionFor(page.slug);
    const list = sectionMap.get(section) ?? [];
    list.push({
      title:
        typeof page.frontmatter.title === 'string'
          ? page.frontmatter.title
          : page.slug,
      url: `${SITE_URL}${mdPathFor('en', page.slug)}`,
      description:
        typeof page.frontmatter.description === 'string'
          ? page.frontmatter.description
          : undefined,
    });
    sectionMap.set(section, list);
  }
  const sections = [...sectionMap.entries()].map(([heading, pages]) => ({
    heading,
    pages,
  }));
  const llmsTxt = buildLlmsTxt({
    siteTitle: 'Tale',
    siteDescription:
      'The sovereign AI platform — local AI models, agents, skills, and automations on your own infrastructure.',
    sections,
    optional: [
      {
        title: 'OpenAPI specification',
        url: `${SITE_URL}/develop/api-reference.md`,
      },
      { title: 'GitHub', url: 'https://github.com/tale-project/tale' },
    ],
  });
  await writeFile(resolve(OUT_DIR, 'llms.txt'), llmsTxt);
  process.stdout.write('built llms.txt\n');

  // --- /llms-full.txt (every page concatenated, English) ------------------
  const llmsFull = buildLlmsFullTxt(
    enPages.map((page) => ({
      title:
        typeof page.frontmatter.title === 'string'
          ? page.frontmatter.title
          : page.slug,
      url: urlFor('en', page.slug),
      body: page.body,
    })),
  );
  await writeFile(resolve(OUT_DIR, 'llms-full.txt'), llmsFull);
  process.stdout.write('built llms-full.txt\n');

  // --- /sitemap.xml with hreflang alternates ------------------------------
  const sitemapPages: SitemapPage[] = [];
  const enSlugs = new Set(enPages.map((p) => p.slug));
  for (const slug of enSlugs) {
    const alternates: Partial<Record<string, string>> = {};
    for (const code of BASE_LOCALES) {
      if ((byLocale.get(code) ?? []).some((p) => p.slug === slug)) {
        alternates[code] = urlFor(code, slug);
      }
    }
    alternates['x-default'] = urlFor('en', slug);
    const enRecord = enPages.find((p) => p.slug === slug);
    sitemapPages.push({
      url: urlFor('en', slug),
      lastModified: enRecord ? mtimeIso(enRecord.filePath) : undefined,
      alternates,
    });
    for (const code of BASE_LOCALES.filter((c) => c !== 'en')) {
      if (!alternates[code]) continue;
      const r = (byLocale.get(code) ?? []).find((p) => p.slug === slug);
      sitemapPages.push({
        url: urlFor(code, slug),
        lastModified: r ? mtimeIso(r.filePath) : undefined,
        alternates,
      });
    }
  }
  await writeFile(resolve(OUT_DIR, 'sitemap.xml'), buildSitemap(sitemapPages));
  process.stdout.write('built sitemap.xml\n');

  // --- /robots.txt --------------------------------------------------------
  const noindex = enPages
    .filter((p) => p.frontmatter.noindex === true)
    .map((p) => pathFor('en', p.slug));
  const robots = buildRobotsTxt({
    sitemaps: [`${SITE_URL}/sitemap.xml`],
    disallow: noindex,
  });
  await writeFile(resolve(OUT_DIR, 'robots.txt'), robots);
  process.stdout.write('built robots.txt\n');

  // --- Per-page .md endpoints --------------------------------------------
  for (const [locale, pages] of byLocale) {
    for (const page of pages) {
      const out = resolve(
        OUT_DIR,
        mdPathFor(locale, page.slug).replace(/^\//, ''),
      );
      await mkdir(dirname(out), { recursive: true });
      await writeFile(
        out,
        pageAsMarkdown({
          frontmatter: {
            title:
              typeof page.frontmatter.title === 'string'
                ? page.frontmatter.title
                : page.slug,
            description:
              typeof page.frontmatter.description === 'string'
                ? page.frontmatter.description
                : '',
          },
          body: page.body,
          siteUrl: SITE_URL,
        }),
      );
    }
  }
  process.stdout.write('built per-page .md endpoints\n');
}

function sectionFor(slug: string): string {
  const top = slug.split('/')[0];
  if (top === 'cloud') return 'Cloud';
  if (top === 'self-hosted') return 'Self-hosted';
  if (top === 'platform') return 'Platform';
  if (top === 'develop') return 'Develop';
  if (top === 'tutorials') return 'Tutorials';
  return 'Start here';
}

import { statSync } from 'node:fs';

function mtimeIso(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

await main();
