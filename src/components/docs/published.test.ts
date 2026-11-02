import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parsePublished,
  publishedSlug,
  publishedSlugProblem,
  recordPublishedSlugs,
} from './published';

let directory: string | undefined;
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

function ledgerFile(slugs: string[]): string {
  directory = mkdtempSync(path.join(tmpdir(), 'tale-published-'));
  const file = path.join(directory, 'published.json');
  writeFileSync(file, JSON.stringify({ _comment: 'kept', slugs }, null, 2));
  return file;
}

describe('recordPublishedSlugs', () => {
  it('appends new pages in URL form and never drops a recorded one', async () => {
    const file = ledgerFile(['gone/page', 'index']);
    const added = await recordPublishedSlugs(file, [
      'index',
      'platform/index',
      'platform/chat/basics',
    ]);
    expect(added).toEqual(['platform', 'platform/chat/basics']);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written).toEqual({
      _comment: 'kept',
      slugs: ['gone/page', 'index', 'platform', 'platform/chat/basics'],
    });
  });

  it('leaves an up-to-date ledger untouched', async () => {
    const file = ledgerFile(['index']);
    const before = readFileSync(file, 'utf8');
    expect(await recordPublishedSlugs(file, ['index'])).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('ledger entries', () => {
  it('parses only a slug array', () => {
    expect(parsePublished({ slugs: ['a'] })).toEqual(['a']);
    expect(() => parsePublished({ slugs: [1] })).toThrow(
      /"slugs" string array/,
    );
    expect(() => parsePublished([])).toThrow(/"slugs" string array/);
  });

  it('names what keeps a slug out of URL form', () => {
    expect(publishedSlug('cloud/index')).toBe('cloud');
    expect(publishedSlug('index')).toBe('index');
    expect(publishedSlugProblem('cloud')).toBeNull();
    expect(publishedSlugProblem('/cloud')).toMatch(/slash/);
    expect(publishedSlugProblem('cloud/index')).toMatch(/index/);
    expect(publishedSlugProblem('')).toMatch(/empty/);
  });
});
