/**
 * The daily `maintenance.expired_sessions` job has a worker, and that worker
 * runs the reaper under the job's own abort signal — so a run that outlasts
 * its queue's expiry stops between batches instead of running beside the
 * retry that replaces it.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reapExpiredSessions } = vi.hoisted(() => ({
  reapExpiredSessions: vi.fn(async () => ({ deleted: 3, drained: true })),
}));

vi.mock('../auth/expired-sessions.ts', () => ({ reapExpiredSessions }));

import { createTaskList } from './task-list.ts';

const SQL = {} as Sql;

describe('maintenance.expired_sessions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the reaper on the worker pool under the job signal', async () => {
    const handler = createTaskList({ sql: SQL })[
      'maintenance.expired_sessions'
    ];
    expect(handler).toBeDefined();
    const controller = new AbortController();
    await handler?.({}, { signal: controller.signal });
    expect(reapExpiredSessions).toHaveBeenCalledTimes(1);
    expect(reapExpiredSessions).toHaveBeenCalledWith(SQL, {
      signal: controller.signal,
    });
  });
});
