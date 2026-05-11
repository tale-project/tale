// Build-time: emit one MiniSearch JSON index per locale into ./public so
// the runtime search dialog can lazy-load the right one.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSearchIndex,
  stripMarkdown,
} from '@tale/webui/search/build-index';

import { listAllContent } from './walk-content';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(SCRIPT_DIR, '..', 'public');

async function main() {
  const records = await listAllContent();
  const byLocale = new Map<string, ReturnType<typeof toSearchDoc>[]>();
  for (const record of records) {
    const list = byLocale.get(record.locale) ?? [];
    list.push(toSearchDoc(record));
    byLocale.set(record.locale, list);
  }

  await mkdir(PUBLIC_DIR, { recursive: true });
  for (const [locale, docs] of byLocale) {
    const index = buildSearchIndex(docs);
    const out = resolve(PUBLIC_DIR, `search-index-${locale}.json`);
    await writeFile(out, JSON.stringify(index));
    process.stdout.write(`built search index ${locale}: ${docs.length} docs\n`);
  }
}

function toSearchDoc(record: {
  locale: string;
  slug: string;
  frontmatter: Record<string, string | boolean>;
  body: string;
}) {
  const headings: string[] = [];
  for (const line of record.body.split(/\r?\n/)) {
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    // Drop heading-anchor extensions like `### Title {#anchor}` — the
    // anchor is a doc-tool artefact and would otherwise leak into search.
    if (m) headings.push(m[2].replace(/\s*\{#[^}]+\}\s*$/, ''));
  }
  const url =
    record.locale === 'en'
      ? slugToPath(record.slug)
      : `/${record.locale}${slugToPath(record.slug)}`;
  // Top-level slug segment doubles as the section key. The dialog maps it to
  // a localised label at render time via the i18n `nav.groups` namespace.
  const firstSegment = record.slug.split('/')[0];
  const section =
    firstSegment && firstSegment !== 'index' ? firstSegment : undefined;
  // Mix URL slug tokens into the searchable headings text. The URL is a
  // curated signal that the page is *about* its slug words — e.g.
  // `/configuration/retention` should match queries for "configuration" or
  // "retention" even when those words aren't in the markdown headings.
  // Uses the headings field (not a new one) so MiniSearch's existing
  // headings-boost applies, no runtime index schema change.
  const slugTokens = record.slug
    .replace(/\/index$/, '')
    .split(/[/_-]/)
    .filter((t) => t && t !== 'index');
  return {
    id: `${record.locale}:${record.slug}`,
    title:
      typeof record.frontmatter.title === 'string'
        ? record.frontmatter.title
        : record.slug,
    headings: [...headings, ...slugTokens].join(' '),
    body: stripMarkdown(record.body),
    url,
    section,
    locale: record.locale,
  };
}

function slugToPath(slug: string): string {
  if (slug === 'index') return '/';
  return '/' + slug.replace(/\/index$/, '');
}

await main();
