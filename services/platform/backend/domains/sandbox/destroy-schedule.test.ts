// @vitest-environment node

/**
 * The Sandboxes page's Destroy is queued, not run in the request: the
 * teardown waits for the session's lifecycle lock and the spawner's delete.
 * The page then reads each row's state back from the queue.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  scheduleSessionDestroy,
  sessionDestroyStates,
} from './destroy-schedule.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

/** A tagged-template stand-in that answers each statement with `rows`. */
function fakeSql(rows: unknown[]) {
  const statements: string[] = [];
  const run = (strings: TemplateStringsArray) => {
    statements.push(strings.join('?'));
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
  it('queues one Destroy per session, keyed by organization and session', async () => {
    const { sql } = fakeSql([{ id: 'row-1' }]);
    await expect(scheduleSessionDestroy(sql, ARGS)).resolves.toBe(true);
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'sandbox.destroy_session',
      ARGS,
      { singletonKey: JSON.stringify(['org-1', 'pa-1']) },
    );
  });

  it('queues nothing when the organization holds no undestroyed row', async () => {
    const { sql, statements } = fakeSql([]);
    await expect(scheduleSessionDestroy(sql, ARGS)).resolves.toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
    // The lookup is scoped to the caller's organization.
    expect(statements[0]).toContain('org_id = ?');
  });
});

describe('sessionDestroyStates', () => {
  const incarnation = 1_000;

  it('reads an unfinished job as pending and a failed one as failed', async () => {
    const { sql } = fakeSql([
      { sessionId: 'queued', state: 'created', createdAt: 2_000 },
      { sessionId: 'retrying', state: 'retry', createdAt: 2_000 },
      { sessionId: 'running', state: 'active', createdAt: 2_000 },
      { sessionId: 'failed', state: 'failed', createdAt: 2_000 },
      { sessionId: 'done', state: 'completed', createdAt: 2_000 },
    ]);
    const states = await sessionDestroyStates(
      sql,
      'org-1',
      ['queued', 'retrying', 'running', 'failed', 'done'].map((sessionId) => ({
        sessionId,
        createdAt: incarnation,
      })),
    );
    expect(Object.fromEntries(states)).toEqual({
      queued: 'pending',
      retrying: 'pending',
      running: 'pending',
      failed: 'failed',
    });
  });

  it('does not pin an older incarnation’s failed Destroy on a fresh workspace', async () => {
    const { sql } = fakeSql([
      { sessionId: 'reused', state: 'failed', createdAt: incarnation - 1 },
    ]);
    const states = await sessionDestroyStates(sql, 'org-1', [
      { sessionId: 'reused', createdAt: incarnation },
    ]);
    expect(states.size).toBe(0);
  });

  it('asks the queue nothing for an empty list', async () => {
    const { sql, statements } = fakeSql([]);
    await expect(sessionDestroyStates(sql, 'org-1', [])).resolves.toEqual(
      new Map(),
    );
    expect(statements).toEqual([]);
  });
});
