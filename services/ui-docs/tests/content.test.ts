import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listAllContent, type ContentRecord } from '@/scripts/walk-content';

/**
 * The page contract from `content/README.md`: complete frontmatter, a
 * description that reads as a sentence, and a body that never opens a second
 * `h1` (the frontmatter `title` is the page's only one — a second breaks the
 * outline for a screen reader).
 *
 * Everything here reads the real markdown through the same walk the build
 * uses, so a page that passes this suite is a page the build can ship.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '..', 'app', 'content', 'frontmatter.json');

const records = await listAllContent();

/** Blank out fenced code blocks: a `# comment` in a bash fence is not a heading. */
function maskCodeFences(body: string): string {
  let inFence = false;
  return body
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

function frontmatterString(
  record: ContentRecord,
  key: 'title' | 'description',
): string {
  const value = record.frontmatter[key];
  return typeof value === 'string' ? value : '';
}

describe('content walk', () => {
  it('finds the pages the site ships', () => {
    expect(records.length).toBeGreaterThan(0);
    // Every page lives in a section folder; a bare `content/foo.md` is not a page.
    expect(records.every((record) => record.slug.includes('/'))).toBe(true);
  });

  it('skips the authoring README', () => {
    expect(records.map((record) => record.slug)).not.toContain('README');
  });
});

describe('frontmatter', () => {
  it('every page has a non-empty title', () => {
    const missing = records
      .filter((record) => frontmatterString(record, 'title').trim() === '')
      .map((record) => record.slug);
    expect(missing, 'pages with no frontmatter title').toEqual([]);
  });

  it('every page has a non-empty description', () => {
    const missing = records
      .filter(
        (record) => frontmatterString(record, 'description').trim() === '',
      )
      .map((record) => record.slug);
    expect(missing, 'pages with no frontmatter description').toEqual([]);
  });

  it('every description is a sentence, not a label', () => {
    const findings = records
      .filter(
        (record) =>
          !frontmatterString(record, 'description').trim().endsWith('.'),
      )
      .map(
        (record) =>
          `${record.slug}: "${frontmatterString(record, 'description')}"`,
      );
    expect(findings, 'descriptions that do not end in a period').toEqual([]);
  });

  it('matches the committed manifest (regenerate via build:content)', async () => {
    const expected: Record<
      string,
      { slug: string; frontmatter: Record<string, string | boolean> }
    > = {};
    for (const record of records) {
      expected[record.slug] = {
        slug: record.slug,
        frontmatter: record.frontmatter,
      };
    }
    const committed: unknown = JSON.parse(await readFile(MANIFEST, 'utf-8'));
    expect(committed).toEqual(expected);
  });
});

describe('page body', () => {
  it('never opens a second h1 — the title is the only one', () => {
    const findings: string[] = [];
    for (const record of records) {
      maskCodeFences(record.body)
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/^#\s/.test(line)) {
            findings.push(`${record.slug}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(findings, 'body lines starting with a single "# "').toEqual([]);
  });

  it('has prose on every page', () => {
    const empty = records
      .filter((record) => record.body.trim().length === 0)
      .map((record) => record.slug);
    expect(empty, 'pages with an empty body').toEqual([]);
  });
});
