// @vitest-environment node

/**
 * The per-org in-flight cap is a concurrency bound, so it is decided inside
 * the transaction that inserts (or re-queues) the job, after a per-org
 * advisory lock. The pre-fix shape counted on the pool and inserted in a
 * separate transaction: N simultaneous pastes all read `count < cap` and all
 * landed. The real-Postgres race rides the integration check; here the
 * ordering (lock → count → insert, all on the transaction handle) and the
 * refusal's rollback are pinned.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteOrgBlobRefs } from '../files/service.ts';
import { ingestVideoUrl, retryVideoLink } from './service.ts';

vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: vi.fn(() => Promise.resolve()),
  putOrgBlobBytes: vi.fn(),
}));
vi.mock('../knowledge/service.ts', () => ({
  markRagQueued: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job-1')),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
}));
vi.mock('../tts/service.ts', () => ({
  checkTtsBudget: vi.fn(() => Promise.resolve({ allowed: true })),
}));
vi.mock('../../auth/membership.ts', () => ({
  getUserTeamIds: vi.fn(() => Promise.resolve([])),
}));

interface Statement {
  text: string;
  values: unknown[];
  via: 'pool' | 'tx';
}

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
}
function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

function jobRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'job-1',
    organizationId: 'org-1',
    threadId: null,
    uploadedBy: 'user-1',
    sourceUrl: 'https://www.youtube.com/watch?v=abc',
    sourceUrlHash: 'h',
    sourcePlatform: 'youtube',
    pastedToken: 'abc',
    status: 'failed',
    statusChangedAt: Date.now() - 60 * 60_000,
    storageRef: null,
    fileMetadataId: null,
    messageBoundAt: null,
    attempts: 0,
    errorReasonCode: 'transient',
    ...overrides,
  };
}

/**
 * Scripted `sql`: the in-flight count answers `inFlight` (`inFlightTx` on
 * the transaction handle when given, so a pool pre-check and the locked
 * count can disagree), a job read pops `jobs`, an insert answers one id,
 * every other statement answers empty (no dedup hit, no donor, no budget
 * rows). Statements record the handle they ran on so the test can prove
 * the count ran INSIDE `begin`.
 */
function fakeSql(script: {
  inFlight: number;
  inFlightTx?: number;
  jobs?: Record<string, unknown>[];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const jobs = [...(script.jobs ?? [])];
  const handle = (via: 'pool' | 'tx') => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = '';
      const flat: unknown[] = [];
      strings.forEach((part, index) => {
        text += part;
        if (index >= values.length) return;
        const value = values[index];
        if (isFragment(value)) text += value.text;
        else {
          text += '?';
          flat.push(value);
        }
      });
      text = text.replace(/\s+/g, ' ').trim();
      statements.push({ text, values: flat, via });
      let rows: unknown[] = [];
      if (
        text.startsWith(
          'SELECT count(*)::text AS count FROM app.video_link_jobs',
        )
      ) {
        rows = [
          {
            count: String(
              via === 'tx'
                ? (script.inFlightTx ?? script.inFlight)
                : script.inFlight,
            ),
          },
        ];
      } else if (text.startsWith('INSERT INTO app.video_link_jobs')) {
        rows = [{ id: 'job-new' }];
      } else if (text.startsWith('SELECT id, org_id AS "organizationId"')) {
        rows = jobs.length > 0 ? [jobs.shift()] : [];
      } else if (text.startsWith('UPDATE app.video_link_jobs SET')) {
        rows = [{ id: 'job-1' }];
      }
      return Promise.resolve(rows);
    };
    tag.unsafe = (text: string): Fragment => ({ [FRAGMENT]: true, text });
    tag.json = (value: unknown): unknown => value;
    return tag;
  };
  const pool: ReturnType<typeof handle> & {
    begin?: (
      callback: (tx: ReturnType<typeof handle>) => unknown,
    ) => Promise<unknown>;
  } = handle('pool');
  pool.begin = async (
    callback: (tx: ReturnType<typeof handle>) => unknown,
  ): Promise<unknown> => {
    const tx = handle('tx');
    statements.push({ text: 'BEGIN', values: [], via: 'tx' });
    try {
      const result = await callback(tx);
      statements.push({ text: 'COMMIT', values: [], via: 'tx' });
      return result;
    } catch (error) {
      statements.push({ text: 'ROLLBACK', values: [], via: 'tx' });
      throw error;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: pool as unknown as Sql, statements };
}

const pasteArgs = {
  organizationId: 'org-1',
  userId: 'user-1',
  url: 'https://www.youtube.com/watch?v=abc',
  pastedToken: 'abc',
};

function kinds(statements: Statement[]): string[] {
  return statements
    .filter((s) => s.via === 'tx')
    .map((s) =>
      s.text === 'BEGIN' || s.text === 'COMMIT' || s.text === 'ROLLBACK'
        ? s.text
        : s.text.includes('pg_advisory_xact_lock')
          ? 'LOCK'
          : s.text.startsWith('SELECT count(*)')
            ? 'COUNT'
            : s.text.startsWith('INSERT INTO app.video_link_jobs')
              ? 'INSERT'
              : s.text.startsWith('UPDATE app.video_link_jobs SET')
                ? 'UPDATE'
                : 'OTHER',
    );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ingestVideoUrl in-flight cap', () => {
  it('locks the org, counts and inserts inside one transaction', async () => {
    const fake = fakeSql({ inFlight: 2 });

    const jobId = await ingestVideoUrl(fake.sql, pasteArgs);

    expect(jobId).toBe('job-new');
    const order = kinds(fake.statements);
    expect(order.indexOf('BEGIN')).toBeLessThan(order.indexOf('LOCK'));
    expect(order.indexOf('LOCK')).toBeLessThan(order.indexOf('COUNT'));
    expect(order.indexOf('COUNT')).toBeLessThan(order.indexOf('INSERT'));
    expect(order).toContain('COMMIT');
    // No count ran on the pool: the decision belongs to the transaction.
    expect(
      fake.statements.some(
        (s) => s.via === 'pool' && s.text.startsWith('SELECT count(*)'),
      ),
    ).toBe(false);
    const lock = fake.statements.find((s) =>
      s.text.includes('pg_advisory_xact_lock'),
    );
    expect(lock?.values).toEqual(['org-1']);
  });

  it('refuses at the cap inside the transaction and rolls back', async () => {
    const fake = fakeSql({ inFlight: 3 });

    await expect(ingestVideoUrl(fake.sql, pasteArgs)).rejects.toMatchObject({
      name: 'VideoLinkError',
      code: 'inFlightCap',
      status: 429,
    });
    const order = kinds(fake.statements);
    expect(order).toEqual(['BEGIN', 'LOCK', 'COUNT', 'ROLLBACK']);
    expect(order).not.toContain('INSERT');
  });
});

describe('retryVideoLink in-flight cap', () => {
  it('re-queues only after the locked count inside the transaction', async () => {
    const fake = fakeSql({ inFlight: 2, jobs: [jobRow({})] });

    await retryVideoLink(fake.sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      jobId: 'job-1',
    });

    const order = kinds(fake.statements);
    expect(order.indexOf('LOCK')).toBeGreaterThan(order.lastIndexOf('BEGIN'));
    expect(order.indexOf('LOCK')).toBeLessThan(order.indexOf('COUNT'));
    expect(order.indexOf('COUNT')).toBeLessThan(order.indexOf('UPDATE'));
    expect(order[order.length - 1]).toBe('COMMIT');
  });

  it('fast-fails on the pool before the cleanup touches the failed job', async () => {
    const fake = fakeSql({
      inFlight: 3,
      jobs: [jobRow({ storageRef: 'blob-1', fileMetadataId: 'meta-1' })],
    });

    await expect(
      retryVideoLink(fake.sql, {
        organizationId: 'org-1',
        userId: 'user-1',
        jobId: 'job-1',
      }),
    ).rejects.toMatchObject({
      name: 'VideoLinkError',
      code: 'inFlightCap',
      status: 429,
    });
    // The refusal came from the pool-side pre-check: nothing was undone.
    expect(
      fake.statements.some(
        (s) => s.via === 'pool' && s.text.startsWith('SELECT count(*)'),
      ),
    ).toBe(true);
    expect(deleteOrgBlobRefs).not.toHaveBeenCalled();
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('DELETE FROM app.file_metadata'),
      ),
    ).toBe(false);
    expect(kinds(fake.statements)).toEqual([]);
  });

  it('lets the locked count inside the transaction decide, not the pre-check', async () => {
    const fake = fakeSql({ inFlight: 2, inFlightTx: 3, jobs: [jobRow({})] });

    await expect(
      retryVideoLink(fake.sql, {
        organizationId: 'org-1',
        userId: 'user-1',
        jobId: 'job-1',
      }),
    ).rejects.toMatchObject({ code: 'inFlightCap', status: 429 });
    const order = kinds(fake.statements);
    expect(order).toEqual(['BEGIN', 'LOCK', 'COUNT', 'ROLLBACK']);
    expect(order).not.toContain('UPDATE');
  });
});
