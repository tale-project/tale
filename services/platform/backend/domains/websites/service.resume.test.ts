// @vitest-environment node

/**
 * A scan cut off mid-link — the process was restarted, deployed over or
 * killed — ends nowhere: the corpus claim stays held and the row reads
 * `scanning`. The regression under test: such a site sat there for the
 * claim's two-hour takeover window with no way to retry it, on every
 * restart that met a scan in progress, and then began again from its first
 * page. The scheduler tick now puts it back on the queue.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job-1')),
}));
vi.mock('../../core/knowledge/pool.ts', () => ({
  getKnowledgePoolForOrg: vi.fn(async () => ({})),
}));
vi.mock('../../core/knowledge/crawl.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/crawl.ts')>()),
  isMemberDomain: vi.fn(async () => true),
  readScanClaim: vi.fn(),
}));
vi.mock('../../core/knowledge/crawl_action.ts', () => ({
  scanWebsiteImpl: vi.fn(async () => null),
  scanDueWebsitesImpl: vi.fn(async () => null),
  persistRobotsRules: vi.fn(async () => undefined),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));
vi.mock('./scan-queue.ts', () => ({
  listScanningRowsWithoutJob: vi.fn(),
  lastFailedScanJob: vi.fn(),
  scanCycleStartedAt: vi.fn(),
}));

import { readScanClaim } from '../../core/knowledge/crawl.ts';
import {
  scanDueWebsitesImpl,
  scanWebsiteImpl,
} from '../../core/knowledge/crawl_action.ts';
import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import {
  EXPIRED_LINK_GRACE_MS,
  MAX_SCAN_RESUMES,
} from '../../core/websites/scan_scheduling.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  lastFailedScanJob,
  listScanningRowsWithoutJob,
  scanCycleStartedAt,
  type ScanningRowWithoutJob,
} from './scan-queue.ts';
import {
  resumeInterruptedScans,
  runWebsitesScan,
  runWebsitesScanDue,
} from './service.ts';

const NOW = Date.parse('2026-09-30T14:00:00.000Z');
const HOUR = 3_600_000;
const CLAIM = '2026-09-30 13:19:05.123456+00';

const interrupted = (
  overrides: Partial<ScanningRowWithoutJob> = {},
): ScanningRowWithoutJob => ({
  id: 'w-1',
  domain: 'example.com',
  organizationId: 'org-1',
  scanInterval: '6h',
  metadata: null,
  ...overrides,
});

interface Captured {
  text: string;
  values: unknown[];
  inTransaction: boolean;
}

/** A platform-database double: every website read answers a scanning row. */
function fakeSql(): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tagIn =
    (inTransaction: boolean) =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$?').replace(/\s+/g, ' ').trim();
      queries.push({ text, values, inTransaction });
      const touched = text.includes('app.websites');
      return Promise.resolve(
        touched
          ? [
              {
                id: values.find((value) => typeof value === 'string') ?? 'w-1',
                organizationId: 'org-1',
                domain: 'example.com',
                kind: 'site',
                status: 'scanning',
                metadata: {},
              },
            ]
          : [],
      );
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

const rowUpdates = (queries: Captured[]) =>
  queries.filter((query) => query.text.startsWith('UPDATE app.websites'));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([interrupted()]);
  vi.mocked(lastFailedScanJob).mockResolvedValue({
    endedAt: NOW - 60_000,
    ranOutItsExpiry: false,
  });
  vi.mocked(scanCycleStartedAt).mockResolvedValue(NOW - HOUR);
  vi.mocked(readScanClaim).mockResolvedValue({
    heartbeat: CLAIM,
    lastScannedAt: NOW - 8 * HOUR,
  });
  vi.mocked(getKnowledgePoolForOrg).mockImplementation(async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the corpus reads are mocked
    return {} as Sql;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resumeInterruptedScans', () => {
  it('queues a first link that takes the dead claim over and continues from where the scan began', async () => {
    const { sql, queries } = fakeSql();
    vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([
      interrupted({ metadata: { scanResumes: 1 } }),
    ]);

    await expect(resumeInterruptedScans(sql)).resolves.toBe(1);

    expect(scanJobs()).toEqual([
      {
        domain: 'example.com',
        orgSlug: 'acme',
        organizationId: 'org-1',
        takeover: CLAIM,
        scanStartedAt: new Date(NOW - HOUR).toISOString(),
      },
    ]);
    // The scan's beginning is looked for after its last finished scan.
    expect(scanCycleStartedAt).toHaveBeenCalledWith(
      sql,
      'example.com',
      NOW - 8 * HOUR,
    );
    // The row's bookkeeping travels with the job: a fresh heartbeat, so the
    // tick that follows does not queue the row again as a stuck one.
    const [update] = rowUpdates(queries);
    expect(update?.inTransaction).toBe(true);
    expect(update?.values).toContainEqual(
      expect.objectContaining({ scanHeartbeatAt: NOW, scanResumes: 2 }),
    );
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[0]).not.toBe(sql);
  });

  it('starts the resumed scan afresh when the queue no longer knows its beginning', async () => {
    vi.mocked(scanCycleStartedAt).mockResolvedValue(null);

    await resumeInterruptedScans(fakeSql().sql);

    expect(scanJobs()).toEqual([
      {
        domain: 'example.com',
        orgSlug: 'acme',
        organizationId: 'org-1',
        takeover: CLAIM,
      },
    ]);
  });

  it('leaves a row whose claim is not held to the status sync', async () => {
    vi.mocked(readScanClaim).mockResolvedValue(null);
    const { sql, queries } = fakeSql();

    await expect(resumeInterruptedScans(sql)).resolves.toBe(0);

    expect(addJobInTx).not.toHaveBeenCalled();
    expect(rowUpdates(queries)).toEqual([]);
  });

  it('waits out the grace after a job that ran out its expiry, without asking the corpus', async () => {
    vi.mocked(lastFailedScanJob).mockResolvedValue({
      endedAt: NOW - 60_000,
      ranOutItsExpiry: true,
    });
    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(0);
    expect(readScanClaim).not.toHaveBeenCalled();

    vi.mocked(lastFailedScanJob).mockResolvedValue({
      endedAt: NOW - EXPIRED_LINK_GRACE_MS,
      ranOutItsExpiry: true,
    });
    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(1);
  });

  it('stops resuming one scan at the limit', async () => {
    vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([
      interrupted({ metadata: { scanResumes: MAX_SCAN_RESUMES } }),
    ]);

    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(0);

    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('resumes one scan for a domain two organizations registered', async () => {
    vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([
      interrupted({ id: 'w-1', organizationId: 'org-1' }),
      interrupted({ id: 'w-2', organizationId: 'org-2' }),
    ]);

    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(1);

    expect(scanJobs()).toHaveLength(1);
  });

  it('does not let one site that cannot be resumed hold up the next', async () => {
    vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([
      interrupted({ id: 'w-1', domain: 'down.example' }),
      interrupted({ id: 'w-2', domain: 'example.com' }),
    ]);
    vi.mocked(getKnowledgePoolForOrg).mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(1);

    expect(scanJobs()).toEqual([
      expect.objectContaining({ domain: 'example.com', takeover: CLAIM }),
    ]);
  });
});

describe('runWebsitesScanDue', () => {
  it('resumes interrupted scans, then runs the tick', async () => {
    await runWebsitesScanDue(fakeSql().sql);

    expect(scanJobs()).toHaveLength(1);
    expect(scanDueWebsitesImpl).toHaveBeenCalledTimes(1);
    const resumedAt = vi.mocked(addJobInTx).mock.invocationCallOrder[0] ?? 0;
    const tickedAt =
      vi.mocked(scanDueWebsitesImpl).mock.invocationCallOrder[0] ?? 0;
    expect(resumedAt).toBeLessThan(tickedAt);
  });

  it('still runs the tick when the queue cannot be read', async () => {
    vi.mocked(listScanningRowsWithoutJob).mockRejectedValue(
      new Error('relation "pgboss.job" does not exist'),
    );

    await runWebsitesScanDue(fakeSql().sql);

    expect(scanDueWebsitesImpl).toHaveBeenCalledTimes(1);
  });
});

describe('runWebsitesScan', () => {
  it("hands the link the takeover it was queued with and its job's signal", async () => {
    const { signal } = new AbortController();
    const payload = {
      domain: 'example.com',
      orgSlug: 'acme',
      organizationId: 'org-1',
      takeover: CLAIM,
      scanStartedAt: new Date(NOW - HOUR).toISOString(),
    };

    await runWebsitesScan(fakeSql().sql, payload, signal);

    expect(scanWebsiteImpl).toHaveBeenCalledWith(expect.anything(), {
      ...payload,
      signal,
    });
  });
});
