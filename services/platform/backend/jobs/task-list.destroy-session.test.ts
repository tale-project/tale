/**
 * The `sandbox.destroy_session` job runs the teardown of the row it was
 * asked for under the job's own abort signal, so an attempt pg-boss has
 * given up on — past the queue's expiry, which fails the job and reopens the
 * row to new work — stops instead of deleting or settling under a turn that
 * took the row back.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { teardownSession } = vi.hoisted(() => ({
  teardownSession: vi.fn(async () => true),
}));

vi.mock('../domains/sandbox/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/sandbox/service.ts')>()),
  teardownSession,
}));

import { createTaskList } from './task-list.ts';

const SQL = {} as Sql;
const PAYLOAD = {
  organizationId: 'org-a',
  sessionId: 'session-a',
  rowId: 'row-a',
};

describe('sandbox.destroy_session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tears down the row it was asked for under the job signal [SBX-R11]', async () => {
    const handler = createTaskList({ sql: SQL })['sandbox.destroy_session'];
    expect(handler).toBeDefined();
    const controller = new AbortController();
    await handler?.(PAYLOAD, { signal: controller.signal });
    expect(teardownSession).toHaveBeenCalledExactlyOnceWith(SQL, {
      ...PAYLOAD,
      signal: controller.signal,
    });
  });
});
