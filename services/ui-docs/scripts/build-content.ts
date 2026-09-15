// Build-time: emit the two generated content artifacts.
//
//  - `public/search-index.json` — the MiniSearch index the ⌘K palette loads.
//  - `app/content/frontmatter.json` — every page's frontmatter keyed by slug,
//    imported synchronously by the loader so the rail, the breadcrumbs and
//    prev/next resolve titles without pulling a single page body.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSearchIndex,
  stripMarkdown,
  type SearchDoc,
} from '@tale/ui/search/static-index/build';

import { listAllContent, type ContentRecord } from './walk-content';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(SCRIPT_DIR, '..', 'public');
const CONTENT_DIR = resolve(SCRIPT_DIR, '..', 'app', 'content');

function toSearchDoc(record: ContentRecord): SearchDoc {
  const headings: string[] = [];
  for (const line of record.body.split(/\r?\n/)) {
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    // Drop heading-anchor extensions like `### Title {#anchor}`.
    if (m) headings.push(m[2].replace(/\s*\{#[^}]+\}\s*$/, ''));
  }
  // The slug's words are a curated signal that the page is ABOUT them, so mix
  // them into the boosted headings field rather than adding a new one.
  const slugTokens = record.slug.split(/[/_-]/).filter(Boolean);
  return {
    id: record.slug,
    title:
      typeof record.frontmatter.title === 'string'
        ? record.frontmatter.title
        : record.slug,
    headings: [...headings, ...slugTokens].join(' '),
    body: stripMarkdown(record.body),
    url: `/docs/${record.slug}`,
    section: record.slug.split('/')[0],
  };
}

async function main() {
  const records = await listAllContent();

  await mkdir(PUBLIC_DIR, { recursive: true });
  const index = buildSearchIndex(records.map(toSearchDoc));
  await writeFile(
    resolve(PUBLIC_DIR, 'search-index.json'),
    JSON.stringify(index),
  );
  process.stdout.write(`built search index: ${records.length} docs\n`);

  const manifest: Record<
    string,
    { slug: string; frontmatter: Record<string, string | boolean> }
  > = {};
  for (const record of records) {
    manifest[record.slug] = {
      slug: record.slug,
      frontmatter: record.frontmatter,
    };
  }
  await mkdir(CONTENT_DIR, { recursive: true });
  await writeFile(
    resolve(CONTENT_DIR, 'frontmatter.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  process.stdout.write(`built frontmatter manifest: ${records.length} pages\n`);
}

await main();
