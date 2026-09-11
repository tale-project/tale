import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { listAllContent, sortContentRecords } from '../scripts/walk-content';

describe('deterministic content discovery', () => {
  test('sorts canonical locale and slug keys regardless of creation order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tale-docs-discovery-'));
    const paths = [
      'fr/z-last.md',
      'en/z-last.md',
      'de/a-first.md',
      'en/a-first.md',
      'fr/a-first.md',
    ];
    try {
      for (const relative of paths) {
        const file = join(root, relative);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, `---\ntitle: ${relative}\n---\nExact body.\n`);
      }
      const records = await listAllContent(root);
      expect(sortContentRecords([...records].reverse())).toEqual(records);
      expect(
        records.map((record) => `${record.locale}:${record.slug}`),
      ).toEqual([
        'de:a-first',
        'en:a-first',
        'en:z-last',
        'fr:a-first',
        'fr:z-last',
      ]);
      expect(
        records.every((record) => record.body.includes('Exact body.')),
      ).toBe(true);
      expect(records.map((record) => record.frontmatter.title)).toEqual([
        'de/a-first.md',
        'en/a-first.md',
        'en/z-last.md',
        'fr/a-first.md',
        'fr/z-last.md',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
