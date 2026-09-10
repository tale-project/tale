// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createWebsiteRow, listWebsites } from './service.ts';

/**
 * The websites rows as the API reference describes them. The regressions
 * under test: the last page of `listWebsites` carried a `continueCursor`
 * next to `isDone: true` (a pager looping on the cursor made one request
 * too many), and a freshly registered site had `kind: null` until the
 * corpus sync filled it in, although the spec's enum is `site | list`.
 */

interface Captured {
  text: string;
  values: unknown[];
}

const row = (index: number) => ({
  id: `w-${index}`,
  organizationId: 'org-1',
  domain: `site-${index}.example`,
  kind: 'site',
  title: null,
  description: null,
  scanInterval: '1d',
  lastScannedAt: null,
  status: 'active',
  pageCount: 0,
  crawledPageCount: 0,
  metadata: null,
  createdAt: 1_700_000_000_000 + index,
  updatedAt: 1_700_000_000_000 + index,
});

function fakeSql(answer: (text: string) => unknown[]): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(answer(text));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return {
    sql: Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql,
    queries,
  };
}

describe('listWebsites cursor', () => {
  it('answers a short page with isDone and an EMPTY cursor', async () => {
    const { sql } = fakeSql(() => [row(1)]);
    const page = await listWebsites(sql, 'org-1', { limit: 25 });
    expect(page.page).toHaveLength(1);
    expect(page.isDone).toBe(true);
    expect(page.continueCursor).toBe('');
  });

  it('carries the cursor only while more rows remain', async () => {
    const { sql } = fakeSql(() => [row(3), row(2), row(1)]);
    const page = await listWebsites(sql, 'org-1', { limit: 2 });
    expect(page.page.map((w) => w.id)).toEqual(['w-3', 'w-2']);
    expect(page.isDone).toBe(false);
    expect(page.continueCursor).toBe(`${row(2).createdAt}:w-2`);
  });
});

describe('createWebsiteRow kind', () => {
  it('registers a whole-site crawl as kind "site" from the first read', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.startsWith('INSERT INTO app.websites') ? [{ id: 'w-new' }] : [],
    );
    await createWebsiteRow(sql, {
      organizationId: 'org-1',
      domain: 'example.com',
      scanInterval: '1d',
      status: 'scanning',
    });
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.websites'),
    );
    expect(insert?.values).toContain('site');
  });

  it('keeps an explicit list kind', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.startsWith('INSERT INTO app.websites') ? [{ id: 'w-new' }] : [],
    );
    await createWebsiteRow(sql, {
      organizationId: 'org-1',
      domain: 'example.com',
      kind: 'list',
      scanInterval: '1d',
    });
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.websites'),
    );
    expect(insert?.values).toContain('list');
    expect(insert?.values).not.toContain('site');
  });
});
