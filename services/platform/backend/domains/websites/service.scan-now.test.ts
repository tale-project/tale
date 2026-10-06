// @vitest-environment node

/**
 * Putting a site back on the crawl outside its interval. The regressions
 * under test: a failed scan could only be retried by waiting out the failure
 * cadence or deleting the site, and a registration that failed once was
 * permanent ("delete it and add it again").
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
  isMemberDomain: vi.fn(),
  registerDomain: vi.fn(async () => undefined),
  deregisterDomain: vi.fn(async () => undefined),
}));
vi.mock('../../core/knowledge/crawl_action.ts', () => ({
  scanWebsiteImpl: vi.fn(async () => null),
  scanDueWebsitesImpl: vi.fn(async () => null),
  persistRobotsRules: vi.fn(async () => undefined),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));

import {
  deregisterDomain,
  isMemberDomain,
  registerDomain,
} from '../../core/knowledge/crawl.ts';
import { scanWebsiteImpl } from '../../core/knowledge/crawl_action.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  resumeScanning,
  runWebsitesScan,
  scanWebsiteNow,
  type WebsiteRow,
} from './service.ts';

const row = (overrides: Partial<WebsiteRow> = {}): WebsiteRow => ({
  id: 'w-1',
  organizationId: 'org-1',
  domain: 'example.com',
  kind: 'site',
  title: null,
  description: null,
  scanInterval: '6h',
  lastScannedAt: null,
  status: 'error',
  pageCount: 0,
  crawledPageCount: 0,
  failedPageCount: 0,
  metadata: { lastSyncError: 'boom', lastScanAttemptAt: 5 },
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

interface Captured {
  text: string;
  values: unknown[];
  inTransaction: boolean;
}

/** A platform-database double answering every website read with `rows`. */
function fakeSql(rows: WebsiteRow[]): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tagIn =
    (inTransaction: boolean) =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$?').replace(/\s+/g, ' ').trim();
      queries.push({ text, values, inTransaction });
      if (text.startsWith('UPDATE app.websites')) {
        const target = rows.find((candidate) => values.includes(candidate.id));
        return Promise.resolve(
          target ? [{ ...target, status: 'scanning', metadata: {} }] : [],
        );
      }
      if (text.includes('FROM app.websites')) {
        const one = rows.filter(
          (candidate) =>
            values.includes(candidate.id) || values.includes(candidate.domain),
        );
        return Promise.resolve(one.length > 0 ? one : rows);
      }
      return Promise.resolve([]);
    };
  const helpers = {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  };
  const sql = Object.assign(tagIn(false), helpers, {
    begin: async (run: (tx: unknown) => Promise<unknown>) =>
      run(Object.assign(tagIn(true), helpers)),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

const scanJobs = () =>
  vi
    .mocked(addJobInTx)
    .mock.calls.filter(([, name]) => name === 'websites.scan')
    .map(([, , payload]) => payload);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('scanWebsiteNow [WEB-R8]', () => {
  it('queues a scan of a failed site and clears its failure bookkeeping, in one transaction', async () => {
    const { sql, queries } = fakeSql([row()]);

    await expect(scanWebsiteNow(sql, row())).resolves.toEqual({ queued: true });

    expect(scanJobs()).toEqual([
      {
        domain: 'example.com',
        orgSlug: 'acme',
        organizationId: 'org-1',
        full: true,
      },
    ]);
    const update = queries.find((q) =>
      q.text.startsWith('UPDATE app.websites'),
    );
    expect(update?.inTransaction).toBe(true);
    expect(update?.values).toContain('scanning');
    expect(update?.values).toContainEqual(
      expect.objectContaining({ lastSyncError: null, lastScanAttemptAt: null }),
    );
  });

  it.each(['scanning', 'deleting'])(
    'leaves a %s site as it is and says nothing was queued',
    async (status) => {
      const { sql, queries } = fakeSql([row({ status })]);

      await expect(scanWebsiteNow(sql, row({ status }))).resolves.toEqual({
        queued: false,
      });

      expect(addJobInTx).not.toHaveBeenCalled();
      expect(queries).toEqual([]);
    },
  );
});

/**
 * A scheduled scan leaves alone the pages a site's sitemap says have not
 * changed. "Scan now" is how a person says the site did change, so its scan
 * asks for every page; a scan the platform starts for its own reasons does
 * not.
 */
describe('a scan a person starts, and one the platform starts', () => {
  const ordinary = {
    domain: 'example.com',
    orgSlug: 'acme',
    organizationId: 'org-1',
  };

  it('Scan now asks for every page [KNOW-R16]', async () => {
    await scanWebsiteNow(fakeSql([row()]).sql, row());

    expect(scanJobs()).toEqual([{ ...ordinary, full: true }]);
  });

  it('a scan the platform starts itself stays an ordinary one', async () => {
    await scanWebsiteNow(fakeSql([row()]).sql, row(), { full: false });

    expect(scanJobs()).toEqual([ordinary]);
  });

  // Resuming answers whether scanning works again, not a change of the site.
  it('Resume scanning queues an ordinary scan', async () => {
    await resumeScanning(fakeSql([row()]).sql, row());

    expect(scanJobs()).toEqual([ordinary]);
  });

  it('the first link hands the word on to the engine', async () => {
    vi.mocked(isMemberDomain).mockResolvedValue(true);

    await runWebsitesScan(fakeSql([row()]).sql, { ...ordinary, full: true });

    expect(scanWebsiteImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ...ordinary, full: true }),
    );
  });
});

describe('runWebsitesScan — a registration that never landed', () => {
  const payload = {
    domain: 'example.com',
    orgSlug: 'acme',
    organizationId: 'org-1',
  };

  it('registers a whole-site row the corpus does not know before its scan', async () => {
    vi.mocked(isMemberDomain).mockResolvedValue(false);
    const { sql } = fakeSql([row({ scanInterval: '1d' })]);

    await runWebsitesScan(sql, payload);

    expect(registerDomain).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      'example.com',
      86_400,
    );
    expect(scanWebsiteImpl).toHaveBeenCalledTimes(1);
  });

  it('leaves a registered site, a URL list and a later link alone', async () => {
    vi.mocked(isMemberDomain).mockResolvedValue(true);
    await runWebsitesScan(fakeSql([row()]).sql, payload);

    vi.mocked(isMemberDomain).mockResolvedValue(false);
    await runWebsitesScan(fakeSql([row({ kind: 'list' })]).sql, payload);
    await runWebsitesScan(fakeSql([row()]).sql, {
      ...payload,
      continuation: 3,
    });

    expect(registerDomain).not.toHaveBeenCalled();
    expect(scanWebsiteImpl).toHaveBeenCalledTimes(3);
  });

  // The row read before the registration was deleted while it was written:
  // the registration would outlive the site.
  it('releases the registration it wrote when the site was deleted meanwhile', async () => {
    vi.mocked(isMemberDomain).mockResolvedValue(false);
    const rows = [row({ scanInterval: '1d' })];
    const { sql } = fakeSql(rows);
    vi.mocked(registerDomain).mockImplementationOnce(async () => {
      // The delete lands while the corpus write is under way.
      rows.length = 0;
    });

    await runWebsitesScan(sql, payload);

    expect(deregisterDomain).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      'example.com',
    );
  });

  it('keeps the registration it wrote while the site stands', async () => {
    vi.mocked(isMemberDomain).mockResolvedValue(false);

    await runWebsitesScan(fakeSql([row({ scanInterval: '1d' })]).sql, payload);

    expect(registerDomain).toHaveBeenCalledTimes(1);
    expect(deregisterDomain).not.toHaveBeenCalled();
  });

  it('still scans when the corpus cannot be asked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(isMemberDomain).mockRejectedValue(new Error('ECONNREFUSED'));

    await runWebsitesScan(fakeSql([row()]).sql, payload);

    expect(registerDomain).not.toHaveBeenCalled();
    expect(scanWebsiteImpl).toHaveBeenCalledTimes(1);
  });
});
