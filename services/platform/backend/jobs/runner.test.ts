// @vitest-environment node

import type { Job, JobResult, PgBoss, WorkOptions } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { startWorker } from './runner.ts';

type WorkHandler = (jobs: Job[]) => Promise<JobResult[]>;

function fakeBoss(): {
  boss: PgBoss;
  send: ReturnType<typeof vi.fn>;
  handlers: Map<string, WorkHandler>;
} {
  const handlers = new Map<string, WorkHandler>();
  const send = vi.fn().mockResolvedValue('requeued');
  const boss = {
    work: vi.fn(
      async (name: string, _options: WorkOptions, handler: WorkHandler) => {
        handlers.set(name, handler);
      },
    ),
    send,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { boss: boss as unknown as PgBoss, send, handlers };
}

const job = { id: 'job-1', data: { seq: 1 } } as Job;

describe('startWorker shouldDefer', () => {
  it('requeues and completes without running the handler', async () => {
    const { boss, send, handlers } = fakeBoss();
    const handler = vi.fn();
    await startWorker({
      boss,
      taskList: { noop: handler },
      shouldDefer: async () => true,
    });

    const results = await handlers.get('noop')?.([job]);
    expect(send).toHaveBeenCalledWith('noop', { seq: 1 }, { startAfter: 5 });
    expect(handler).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: 'job-1', status: 'completed' }]);
  });

  it('runs the handler when the worker is not deferring', async () => {
    const { boss, send, handlers } = fakeBoss();
    const handler = vi.fn().mockResolvedValue(undefined);
    await startWorker({
      boss,
      taskList: { noop: handler },
      shouldDefer: async () => false,
    });

    const results = await handlers.get('noop')?.([job]);
    expect(send).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({ seq: 1 });
    expect(results).toEqual([{ id: 'job-1', status: 'completed' }]);
  });
});
