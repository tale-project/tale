// @vitest-environment node

/**
 * What saving or removing the organization's embedding model means for its
 * websites. The regression under test: a site crawled before the model
 * existed kept waiting for its own interval — up to thirty days — before a
 * scan embedded its pages, and nothing told the Websites page that search
 * had become (or stopped being) able to reach them.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job-1')),
}));
vi.mock('../../core/knowledge/pool.ts', () => ({
  getKnowledgePoolForOrg: vi.fn(async () => ({})),
}));
vi.mock('../../core/knowledge/crawl.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/crawl.ts')>()),
  listVectorlessDomains: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));

import { listVectorlessDomains } from '../../core/knowledge/crawl.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { websitesAfterEmbeddingChange, type WebsiteRow } from './service.ts';

const row = (overrides: Partial<WebsiteRow> = {}): WebsiteRow => ({
  id: 'w-1',
  organizationId: 'org-1',
  domain: 'example.com',
  kind: 'site',
  title: null,
  description: null,
  scanInterval: '6h',
  lastScannedAt: null,
  status: 'active',
  pageCount: 0,
  crawledPageCount: 0,
  failedPageCount: 0,
  metadata: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

interface Captured {
  text: string;
  values: unknown[];
}

/** A platform-database double answering every website read with `rows`. */
function fakeSql(rows: WebsiteRow[]): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.startsWith('UPDATE app.websites')) {
      const target = rows.find((candidate) => values.includes(candidate.id));
      return Promise.resolve(
        target ? [{ ...target, status: 'scanning', metadata: {} }] : [],
      );
    }
    if (text.includes('FROM app.websites')) {
      const one = rows.filter((candidate) => values.includes(candidate.id));
      return Promise.resolve(one.length > 0 ? one : rows);
    }
    return Promise.resolve([]);
  };
  const helpers = {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  };
  const sql = Object.assign(tag, helpers, {
    begin: async (run: (tx: unknown) => Promise<unknown>) =>
      run(Object.assign(tag, helpers)),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

const scanJobs = (): unknown[] =>
  vi
    .mocked(addJobInTx)
    .mock.calls.filter(([, name]) => name === 'websites.scan')
    .map(([, , payload]) => payload);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('websitesAfterEmbeddingChange', () => {
  const sites = [
    row({ id: 'w-vectorless', domain: 'docs.example', status: 'active' }),
    row({ id: 'w-embedded', domain: 'embedded.example', status: 'active' }),
    row({ id: 'w-failed', domain: 'failed.example', status: 'error' }),
    row({
      id: 'w-paused',
      domain: 'paused.example',
      status: 'error',
      metadata: { scanPausedAt: 9 },
    }),
  ];
  const hints = (queries: Captured[]) =>
    queries
      .filter((q) => q.text.startsWith('INSERT INTO app_realtime.outbox'))
      .map((q) => q.values);

  it('scans the sites a saved model can do better by, and tells the page', async () => {
    vi.mocked(listVectorlessDomains).mockResolvedValue(['docs.example']);
    const { sql, queries } = fakeSql(sites);

    await expect(
      websitesAfterEmbeddingChange(sql, 'org-1', 'saved'),
    ).resolves.toEqual({ queued: 2 });

    expect(scanJobs()).toEqual([
      expect.objectContaining({ domain: 'docs.example' }),
      expect.objectContaining({ domain: 'failed.example' }),
    ]);
    // Nothing says these sites changed: the scans embed stored text and
    // retry what failed, and ask for no unchanged page again.
    expect(scanJobs()).not.toContainEqual(
      expect.objectContaining({ full: true }),
    );
    // The organization-wide hint the readiness notice re-reads on.
    expect(hints(queries)).toContainEqual(['org-1', null, 'website', null]);
  });

  it('only tells the page when the model is removed', async () => {
    const { sql, queries } = fakeSql(sites);

    await expect(
      websitesAfterEmbeddingChange(sql, 'org-1', 'removed'),
    ).resolves.toEqual({ queued: 0 });

    expect(addJobInTx).not.toHaveBeenCalled();
    expect(listVectorlessDomains).not.toHaveBeenCalled();
    expect(hints(queries)).toEqual([['org-1', null, 'website', null]]);
  });
});
