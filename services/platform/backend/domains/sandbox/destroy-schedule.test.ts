// @vitest-environment node

/**
 * The Sandboxes page's Destroy is queued, not run in the request: the
 * teardown waits for the session's lifecycle lock and the spawner's delete.
 * Each job names the row it was asked for, and the page reads each row's
 * state back from the queue.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  scheduleSessionDestroy,
  sessionDestroyPending,
  sessionDestroyStates,
} from './destroy-schedule.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

/** A tagged-template stand-in that answers each statement with `rows`. */
function fakeSql(rows: unknown[]) {
  const statements: { text: string; values: unknown[] }[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  const sql = Object.assign(run, {
    begin: (work: (tx: typeof run) => Promise<unknown>) => work(run),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stand-in serves only the tagged-template and begin calls this module makes
  return { sql: sql as unknown as Sql, statements };
}

const ARGS = { organizationId: 'org-1', sessionId: 'pa-1' };

beforeEach(() => {
  vi.mocked(addJobInTx).mockReset();
});

describe('scheduleSessionDestroy', () => {
  it('queues a Destroy of the latest row, keyed by organization, session and row', async () => {
    const { sql, statements } = fakeSql([{ id: 'row-2', status: 'active' }]);
    await expect(scheduleSessionDestroy(sql, ARGS)).resolves.toBe(true);
    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      'sandbox.destroy_session',
      { ...ARGS, rowId: 'row-2' },
      { singletonKey: JSON.stringify(['org-1', 'pa-1', 'row-2']) },
    );
    // The organization's admission lock first, which every reserve and
    // resume takes: a turn is admitted either before the request, or after
    // it and refused while the Destroy is pending.
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
    expect(statements[0]?.values).toEqual(['org-1']);
    // The row the teardown will read: the newest under the id, in the
    // caller's organization.
    expect(statements[1]?.text).toContain('ORDER BY created_at_ms DESC');
    expect(statements[1]?.values).toEqual(['org-1', 'pa-1']);
  });

  it('queues nothing when the organization holds no row under the id', async () => {
    const { sql } = fakeSql([]);
    await expect(scheduleSessionDestroy(sql, ARGS)).resolves.toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues nothing when the latest row is already destroyed', async () => {
    const { sql } = fakeSql([{ id: 'row-1', status: 'destroyed' }]);
    await expect(scheduleSessionDestroy(sql, ARGS)).resolves.toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('sessionDestroyStates', () => {
  it('reads an unfinished job as pending and a failed one as failed', async () => {
    const { sql } = fakeSql([
      { sessionId: 'queued', state: 'created' },
      { sessionId: 'retrying', state: 'retry' },
      { sessionId: 'running', state: 'active' },
      { sessionId: 'failed', state: 'failed' },
      { sessionId: 'done', state: 'completed' },
      { sessionId: 'cancelled', state: 'cancelled' },
    ]);
    const states = await sessionDestroyStates(sql, 'org-1', [
      'queued',
      'retrying',
      'running',
      'failed',
      'done',
      'cancelled',
    ]);
    expect(Object.fromEntries(states)).toEqual({
      queued: 'pending',
      retrying: 'pending',
      running: 'pending',
      failed: 'failed',
    });
  });

  it('reads each job against the live row it was asked for', async () => {
    const { sql, statements } = fakeSql([]);
    await sessionDestroyStates(sql, 'org-1', ['pa-1']);
    // A job for an earlier incarnation under the same id matches no row
    // listed today, so a fresh workspace never reads as being destroyed.
    expect(statements[0]?.text).toContain("s.id::text = j.data ->> 'rowId'");
    expect(statements[0]?.text).toContain('s.status = ANY(');
    expect(statements[0]?.values).toContain('org-1');
  });

  it('asks the queue nothing for an empty list', async () => {
    const { sql, statements } = fakeSql([]);
    await expect(sessionDestroyStates(sql, 'org-1', [])).resolves.toEqual(
      new Map(),
    );
    expect(statements).toEqual([]);
  });
});

describe('sessionDestroyPending', () => {
  it('reads a queued, retrying or running Destroy of a live row under the id', async () => {
    const { sql, statements } = fakeSql([{ pending: true }]);
    await expect(sessionDestroyPending(sql, ARGS)).resolves.toBe(true);
    const [statement] = statements;
    expect(statement?.text).toContain('j.name = ?');
    expect(statement?.values).toContain('sandbox.destroy_session');
    // Unfinished only: a Destroy whose ladder ran out (`failed`) no longer
    // holds the row, so a workspace id is never locked for good.
    expect(statement?.values).toContainEqual(['created', 'retry', 'active']);
    // Against the row the job names, live, in the caller's organization.
    expect(statement?.text).toContain("s.id::text = j.data ->> 'rowId'");
    expect(statement?.text).toContain('s.status = ANY(');
    expect(statement?.values).toContainEqual([
      'creating',
      'active',
      'degraded',
      'stopped',
    ]);
    expect(statement?.values.filter((value) => value === 'org-1')).toHaveLength(
      2,
    );
    expect(statement?.values).toContain('pa-1');
  });

  it('narrows to one row when asked for it', async () => {
    const { sql, statements } = fakeSql([{ pending: false }]);
    await expect(
      sessionDestroyPending(sql, { ...ARGS, rowId: 'row-2' }),
    ).resolves.toBe(false);
    expect(
      statements[0]?.values.filter((value) => value === 'row-2'),
    ).toHaveLength(2);
  });

  it('reads any live row under the id without one', async () => {
    const { sql, statements } = fakeSql([{ pending: false }]);
    await sessionDestroyPending(sql, ARGS);
    expect(
      statements[0]?.values.filter((value) => value === null),
    ).toHaveLength(2);
  });
});
