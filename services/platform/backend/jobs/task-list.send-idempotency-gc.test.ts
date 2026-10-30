/**
 * The hourly `chat.send_idempotency_gc` job has a worker, and that worker
 * runs the send-key sweep under the job's own abort signal — so a run that
 * outlasts its queue's expiry stops between batches.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sweepExpiredSendKeys } = vi.hoisted(() => ({
  sweepExpiredSendKeys: vi.fn(async () => ({ deleted: 3, drained: true })),
}));

vi.mock('../domains/chat/send-idempotency.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/chat/send-idempotency.ts')
  >()),
  sweepExpiredSendKeys,
}));

import { createTaskList } from './task-list.ts';

const SQL = {} as Sql;

describe('chat.send_idempotency_gc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the send-key sweep on the worker pool under the job signal', async () => {
    const handler = createTaskList({ sql: SQL })['chat.send_idempotency_gc'];
    expect(handler).toBeDefined();
    const controller = new AbortController();
    await handler?.({}, { signal: controller.signal });
    expect(sweepExpiredSendKeys).toHaveBeenCalledTimes(1);
    expect(sweepExpiredSendKeys).toHaveBeenCalledWith(SQL, {
      signal: controller.signal,
    });
  });
});
