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
  scanJobEnded: vi.fn(async () => false),
}));

import { readScanClaim } from '../../core/knowledge/crawl.ts';
import {
  scanDueWebsitesImpl,
  scanWebsiteImpl,
} from '../../core/knowledge/crawl_action.ts';
import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import { internal } from '../../core/lib/handler_names.ts';
import {
  EXPIRED_LINK_GRACE_MS,
  LINK_LIFETIME_MS,
  MAX_SCAN_RESUMES,
} from '../../core/websites/scan_scheduling.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { TASK_QUEUE_OPTIONS } from '../../jobs/tasks.ts';
import {
  lastFailedScanJob,
  listScanningRowsWithoutJob,
  scanCycleStartedAt,
  type ScanningRowWithoutJob,
  scanJobEnded,
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

const rowSyncJobs = () =>
  vi
    .mocked(addJobInTx)
    .mock.calls.filter(([, name]) => name === 'websites.row_sync')
    .map(([, , payload]) => payload);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([interrupted()]);
  // What a restart leaves: the link's job failed a minute into its run.
  vi.mocked(lastFailedScanJob).mockResolvedValue({
    endedAt: NOW - 60_000,
    ranOutItsExpiry: false,
  });
  vi.mocked(scanCycleStartedAt).mockResolvedValue(NOW - HOUR);
  vi.mocked(readScanClaim).mockResolvedValue({
    heartbeat: CLAIM,
    ageMs: 2 * 60_000,
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

  // The corpus finished (or dropped) the scan, but the row's last sync was
  // lost with the process: nothing queued one, so the row read Scanning
  // until someone opened the page.
  it('syncs a row whose claim is no longer held, and resumes nothing', async () => {
    vi.mocked(readScanClaim).mockResolvedValue(null);
    const { sql, queries } = fakeSql();

    await expect(resumeInterruptedScans(sql)).resolves.toBe(0);

    expect(scanJobs()).toEqual([]);
    expect(rowSyncJobs()).toEqual([{ orgSlug: 'acme', domain: 'example.com' }]);
    expect(rowUpdates(queries)).toEqual([]);
  });

  // What a killed worker leaves: its heartbeat stopped and the supervisor
  // failed the job. The claim is as fresh as the link's start.
  it('resumes at once after a job that ended before its expiry, however fresh the claim', async () => {
    vi.mocked(readScanClaim).mockResolvedValue({
      heartbeat: CLAIM,
      ageMs: 30_000,
      lastScannedAt: NOW - 8 * HOUR,
    });

    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(1);
  });

  it('takes a claim no job speaks for only once it has outlived any link', async () => {
    vi.mocked(lastFailedScanJob).mockResolvedValue(null);
    vi.mocked(readScanClaim).mockResolvedValue({
      heartbeat: CLAIM,
      ageMs: LINK_LIFETIME_MS - 60_000,
      lastScannedAt: NOW - 8 * HOUR,
    });
    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(0);

    vi.mocked(readScanClaim).mockResolvedValue({
      heartbeat: CLAIM,
      ageMs: LINK_LIFETIME_MS,
      lastScannedAt: NOW - 8 * HOUR,
    });
    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(1);
  });

  it('waits out the grace after a job that ran out its expiry', async () => {
    vi.mocked(readScanClaim).mockResolvedValue({
      heartbeat: CLAIM,
      ageMs: 2 * LINK_LIFETIME_MS,
      lastScannedAt: NOW - 8 * HOUR,
    });
    vi.mocked(lastFailedScanJob).mockResolvedValue({
      endedAt: NOW - 60_000,
      ranOutItsExpiry: true,
    });
    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(0);

    vi.mocked(lastFailedScanJob).mockResolvedValue({
      endedAt: NOW - EXPIRED_LINK_GRACE_MS,
      ranOutItsExpiry: true,
    });
    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(1);
  });

  it('holds the claim lifetime equal to the scan job expiry', () => {
    expect(TASK_QUEUE_OPTIONS['websites.scan'].expireInSeconds).toBe(
      LINK_LIFETIME_MS / 1000,
    );
  });

  it('stops resuming one scan at the limit [WEB-R7]', async () => {
    vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([
      interrupted({ metadata: { scanResumes: MAX_SCAN_RESUMES } }),
    ]);

    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(0);

    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('resumes one scan for a domain two organizations registered, and books it on both rows', async () => {
    vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([
      interrupted({ id: 'w-1', organizationId: 'org-1' }),
      interrupted({ id: 'w-2', organizationId: 'org-2' }),
    ]);
    const { sql, queries } = fakeSql();

    await expect(resumeInterruptedScans(sql)).resolves.toBe(1);

    expect(scanJobs()).toHaveLength(1);
    const updated = rowUpdates(queries).map((query) => query.values);
    expect(updated.filter((values) => values.includes('w-1'))).toHaveLength(1);
    expect(updated.filter((values) => values.includes('w-2'))).toHaveLength(1);
  });

  // Counted per row, a domain two organizations shared was resumed three
  // times for each of them.
  it('counts the resumes of a shared domain by the most any of its rows had', async () => {
    vi.mocked(listScanningRowsWithoutJob).mockResolvedValue([
      interrupted({
        id: 'w-1',
        organizationId: 'org-1',
        metadata: { scanResumes: MAX_SCAN_RESUMES },
      }),
      interrupted({ id: 'w-2', organizationId: 'org-2' }),
    ]);

    await expect(resumeInterruptedScans(fakeSql().sql)).resolves.toBe(0);

    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('does not let one site that cannot be resumed hold up the next [WEB-R7]', async () => {
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

    await runWebsitesScan(fakeSql().sql, payload, { signal, jobId: 'job-7' });

    expect(scanWebsiteImpl).toHaveBeenCalledWith(expect.anything(), {
      ...payload,
      signal,
    });
  });

  /**
   * A link whose job the supervisor failed (its worker stalled past the
   * heartbeat) may still be running when the scheduler resumes its scan.
   * Were it to queue its successor, a second chain would crawl the site
   * beside the resumed one.
   */
  describe('a link whose job ended while it ran', () => {
    const continuation = {
      domain: 'example.com',
      orgSlug: 'acme',
      organizationId: 'org-1',
      continuation: 3,
      scanStartedAt: new Date(NOW - HOUR).toISOString(),
    };

    beforeEach(() => {
      vi.mocked(scanWebsiteImpl).mockImplementation(async (ctx) => {
        await ctx.scheduler.runAfter(
          5_000,
          internal.knowledge.crawl_action.scanWebsite,
          continuation,
        );
        return null;
      });
    });

    it('queues no successor', async () => {
      vi.mocked(scanJobEnded).mockResolvedValue(true);
      const { sql } = fakeSql();

      await runWebsitesScan(sql, continuation, { jobId: 'job-7' });

      expect(scanJobEnded).toHaveBeenCalledWith(sql, 'job-7');
      expect(scanJobs()).toEqual([]);
    });

    it('queues its successor while its job is still its own', async () => {
      vi.mocked(scanJobEnded).mockResolvedValue(false);

      await runWebsitesScan(fakeSql().sql, continuation, { jobId: 'job-7' });

      expect(scanJobs()).toEqual([continuation]);
    });

    it('asks nothing when no job runs it', async () => {
      await runWebsitesScan(fakeSql().sql, continuation);

      expect(scanJobEnded).not.toHaveBeenCalled();
      expect(scanJobs()).toEqual([continuation]);
    });
  });
});
