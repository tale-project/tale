// @vitest-environment node

/**
 * A title or description the author set on a website row is theirs. The
 * regression under test: every corpus sync wrote the crawl's discovered
 * homepage title over the row, so a `PATCH /websites/{id}` rename lasted
 * exactly until the next scan. Discovered values now fill blanks only.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/knowledge/pool.ts', () => ({
  getKnowledgePoolForOrg: vi.fn(async () => ({})),
}));
vi.mock('../../core/knowledge/crawl.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/crawl.ts')>()),
  fetchWebsiteInfoFromCorpus: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));

import { fetchWebsiteInfoFromCorpus } from '../../core/knowledge/crawl.ts';
import { syncSingleWebsite } from './service.ts';

interface Captured {
  text: string;
  values: unknown[];
}

const row = (title: string | null) => ({
  id: 'w-1',
  organizationId: 'org-1',
  domain: 'example.com',
  kind: 'site',
  title,
  description: null,
  scanInterval: '1d',
  lastScannedAt: null,
  status: 'scanning',
  pageCount: 0,
  crawledPageCount: 0,
  metadata: null,
  createdAt: 1,
  updatedAt: 1,
});

function fakeSql(website: ReturnType<typeof row>): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM app.websites')) return Promise.resolve([website]);
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
    json: (v: unknown) => v,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

beforeEach(() => {
  vi.mocked(fetchWebsiteInfoFromCorpus).mockResolvedValue({
    status: 'active',
    kind: 'site',
    page_count: 1,
    crawled_count: 1,
    title: 'Example Domain',
    description: 'What the homepage says',
    last_scanned_at: null,
    error: null,
  } as never);
});

const patchValues = (queries: Captured[]) =>
  queries.find((q) => q.text.startsWith('UPDATE app.websites'))?.values ?? [];

describe('syncSingleWebsite — discovered title and description', () => {
  it('fills a row that has none', async () => {
    const { sql, queries } = fakeSql(row(null));
    await syncSingleWebsite(sql, {
      websiteId: 'w-1',
      domain: 'example.com',
      organizationId: 'org-1',
    });
    expect(patchValues(queries)).toEqual(
      expect.arrayContaining(['Example Domain', 'What the homepage says']),
    );
  });

  it('never overwrites a title the author set', async () => {
    const { sql, queries } = fakeSql(row('Our docs'));
    await syncSingleWebsite(sql, {
      websiteId: 'w-1',
      domain: 'example.com',
      organizationId: 'org-1',
    });
    const values = patchValues(queries);
    expect(values).not.toContain('Example Domain');
    // The description was blank on the row, so it is still filled.
    expect(values).toContain('What the homepage says');
  });
});
