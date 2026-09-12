// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { createWebsiteRow, listWebsites, registerWebsite } from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job-1')),
}));

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

/**
 * C-01 / C-02: the ONE registration choreography both doors call. A row
 * that already covers the domain — under its own spelling or its www/apex
 * sibling — is judged before anything is written: only a URL list posted
 * onto a domain registered AS A LIST extends it; every other collision is
 * the 409 naming the stored row, with no patch and no job.
 */
describe('registerWebsite', () => {
  const stored = (overrides: { kind: 'site' | 'list' | null }) => ({
    ...row(1),
    domain: 'docs.example',
    ...overrides,
  });

  function transactingSql(
    answer: (text: string, values: unknown[]) => unknown[],
  ): {
    sql: Sql;
    queries: Captured[];
  } {
    const queries: Captured[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$?').replace(/\s+/g, ' ').trim();
      queries.push({ text, values });
      return Promise.resolve(answer(text, values));
    };
    const handle = Object.assign(tag, { unsafe: (t: string) => t });
    const pool = Object.assign(handle, {
      begin: (callback: (tx: unknown) => Promise<unknown>) => callback(handle),
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    return { sql: pool as unknown as Sql, queries };
  }

  const coveringLookup = (text: string) =>
    text.includes('FROM app.websites') && text.includes('ANY');

  beforeEach(() => {
    vi.mocked(addJobInTx).mockClear();
  });

  it('extends a list registration of the same host: patch, job, merged', async () => {
    // The covering lookup, the patch's own by-id load, and its RETURNING.
    const { sql, queries } = transactingSql((text) =>
      coveringLookup(text) ||
      text.includes('FROM app.websites WHERE id') ||
      text.startsWith('UPDATE app.websites')
        ? [stored({ kind: 'list' })]
        : [],
    );
    const outcome = await registerWebsite(sql, {
      organizationId: 'org-1',
      domain: 'docs.example',
      scanInterval: '1d',
      urls: ['https://docs.example/a', 'https://www.docs.example/b'],
    });
    expect(outcome).toEqual({
      id: 'w-1',
      merged: true,
      domain: 'docs.example',
    });
    expect(queries.some((q) => q.text.startsWith('INSERT'))).toBe(false);
    expect(vi.mocked(addJobInTx)).toHaveBeenCalledWith(
      expect.anything(),
      'websites.register',
      expect.objectContaining({
        websiteId: 'w-1',
        domain: 'docs.example',
        urls: ['https://docs.example/a', 'https://www.docs.example/b'],
      }),
    );
  });

  it.each([
    [
      'a whole-site crawl, with urls',
      { kind: 'site' as const },
      ['https://docs.example/a'],
    ],
    [
      'a legacy row without a kind, with urls',
      { kind: null },
      ['https://docs.example/a'],
    ],
    ['a list, without urls', { kind: 'list' as const }, undefined],
  ])(
    'refuses %s with 409 naming the row, writing nothing',
    async (_case, overrides, urls) => {
      const { sql, queries } = transactingSql((text) =>
        coveringLookup(text) ? [stored(overrides)] : [],
      );
      await expect(
        registerWebsite(sql, {
          organizationId: 'org-1',
          domain: 'docs.example',
          scanInterval: '1d',
          ...(urls === undefined ? {} : { urls }),
        }),
      ).rejects.toMatchObject({
        code: 'WEBSITE_DUPLICATE_DOMAIN',
        status: 409,
        data: { websiteId: 'w-1', domain: 'docs.example' },
      });
      expect(queries.some((q) => /^(INSERT|UPDATE)/.test(q.text))).toBe(false);
      expect(vi.mocked(addJobInTx)).not.toHaveBeenCalled();
    },
  );

  it('refuses the www/apex sibling of a stored domain, naming the stored spelling — a list included', async () => {
    const { sql, queries } = transactingSql((text) =>
      coveringLookup(text) ? [stored({ kind: 'list' })] : [],
    );
    await expect(
      registerWebsite(sql, {
        organizationId: 'org-1',
        domain: 'www.docs.example',
        scanInterval: '1d',
        urls: ['https://docs.example/a'],
      }),
    ).rejects.toMatchObject({
      code: 'WEBSITE_DUPLICATE_DOMAIN',
      status: 409,
      data: { websiteId: 'w-1', domain: 'docs.example' },
    });
    const lookup = queries.find((q) => coveringLookup(q.text));
    expect(lookup?.values).toEqual(
      expect.arrayContaining([
        'org-1',
        expect.arrayContaining(['www.docs.example', 'docs.example']),
      ]),
    );
    expect(vi.mocked(addJobInTx)).not.toHaveBeenCalled();
  });

  it('validates the list against the domain before looking anything up', async () => {
    const { sql, queries } = transactingSql(() => []);
    await expect(
      registerWebsite(sql, {
        organizationId: 'org-1',
        domain: 'docs.example',
        scanInterval: '1d',
        urls: ['https://elsewhere.example/x'],
      }),
    ).rejects.toMatchObject({ code: 'WEBSITE_INVALID_LIST_URL', status: 400 });
    expect(queries).toEqual([]);
  });
});
