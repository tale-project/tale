// @vitest-environment node

import type { Job, JobResult, PgBoss, WorkOptions } from 'pg-boss';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportError } from '../error-reporting.ts';
import { startWorker } from './runner.ts';

vi.mock('../error-reporting.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../error-reporting.ts')>()),
  reportError: vi.fn(),
}));

afterEach(() => {
  vi.mocked(reportError).mockClear();
});

type WorkHandler = (jobs: Job[]) => Promise<JobResult[]>;

function fakeBoss(): {
  boss: PgBoss;
  send: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  calls: string[];
  handlers: Map<string, WorkHandler>;
  workOptions: Map<string, WorkOptions>;
} {
  const handlers = new Map<string, WorkHandler>();
  const workOptions = new Map<string, WorkOptions>();
  const calls: string[] = [];
  const send = vi.fn(async () => {
    calls.push('send');
    return 'requeued';
  });
  const complete = vi.fn(async () => {
    calls.push('complete');
    return { jobs: ['job-1'], requested: 1, affected: 1 };
  });
  const boss = {
    work: vi.fn(
      async (name: string, options: WorkOptions, handler: WorkHandler) => {
        handlers.set(name, handler);
        workOptions.set(name, options);
      },
    ),
    send,
    complete,
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    boss: boss as unknown as PgBoss,
    send,
    complete,
    calls,
    handlers,
    workOptions,
  };
}

/** A pool whose one transaction records that it opened and ended. */
function fakeSql(calls: string[]): Sql {
  const tx = { unsafe: vi.fn(async () => []) };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return {
    begin: async (body: (t: typeof tx) => Promise<unknown>) => {
      calls.push('begin');
      const result = await body(tx);
      calls.push('commit');
      return result;
    },
  } as unknown as Sql;
}

/** A fetched job with the metadata the worker asks for. */
const job = {
  id: 'job-1',
  data: { seq: 1 },
  signal: new AbortController().signal,
  singletonKey: null,
  priority: 0,
} as unknown as Job;

describe('startWorker shouldDefer', () => {
  it('hands a keyless job over — completed and re-queued five seconds out in one transaction — without running the handler', async () => {
    const { boss, send, complete, calls, handlers, workOptions } = fakeBoss();
    const handler = vi.fn();
    await startWorker({
      boss,
      taskList: { noop: handler },
      shouldDefer: async () => true,
      sql: fakeSql(calls),
    });

    const results = await handlers.get('noop')?.([job]);
    expect(workOptions.get('noop')).toMatchObject({ includeMetadata: true });
    expect(complete).toHaveBeenCalledWith('noop', 'job-1', null, {
      db: expect.objectContaining({ executeSql: expect.any(Function) }),
    });
    expect(send).toHaveBeenCalledWith(
      'noop',
      { seq: 1 },
      {
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
        startAfter: 5,
      },
    );
    // The claim ends first, inside the same transaction as its successor.
    expect(calls).toEqual(['begin', 'complete', 'send', 'commit']);
    expect(handler).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: 'job-1', status: 'completed' }]);
  });

  it('keeps a keyed job’s singleton key and priority, so its queue’s key still dedupes the successor', async () => {
    const { boss, send, handlers } = fakeBoss();
    await startWorker({
      boss,
      taskList: { 'task.agent_retry_recheck': vi.fn() },
      shouldDefer: async () => true,
      sql: fakeSql([]),
    });

    await handlers.get('task.agent_retry_recheck')?.([
      {
        ...job,
        singletonKey: 'agent-retry:org-1:task-1:run-1',
        priority: 10,
      } as unknown as Job,
    ]);
    expect(send).toHaveBeenCalledWith(
      'task.agent_retry_recheck',
      { seq: 1 },
      expect.objectContaining({
        startAfter: 5,
        singletonKey: 'agent-retry:org-1:task-1:run-1',
        priority: 10,
      }),
    );
  });

  it('keeps the claim when the hand-over fails, for pg-boss to retry', async () => {
    const { boss, send, handlers } = fakeBoss();
    send.mockRejectedValueOnce(new Error('insert refused'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startWorker({
      boss,
      taskList: { noop: vi.fn() },
      shouldDefer: async () => true,
      sql: fakeSql([]),
    });

    const results = await handlers.get('noop')?.([job]);
    expect(results?.[0]).toMatchObject({ id: 'job-1', status: 'failed' });
    error.mockRestore();
  });

  it('runs the handler when the worker is not deferring', async () => {
    const { boss, send, handlers } = fakeBoss();
    const handler = vi.fn().mockResolvedValue(undefined);
    await startWorker({
      boss,
      taskList: { noop: handler },
      shouldDefer: async () => false,
      sql: fakeSql([]),
    });

    const results = await handlers.get('noop')?.([job]);
    expect(send).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(
      { seq: 1 },
      { signal: job.signal, jobId: job.id },
    );
    expect(results).toEqual([{ id: 'job-1', status: 'completed' }]);
  });
});

describe('startWorker job budget', () => {
  it('hands every handler the signal pg-boss aborts when the job outlives its budget', async () => {
    const { boss, handlers } = fakeBoss();
    const seen: (AbortSignal | undefined)[] = [];
    await startWorker({
      boss,
      taskList: {
        noop: async (_payload, context) => {
          seen.push(context?.signal);
        },
      },
    });
    const controller = new AbortController();

    await handlers.get('noop')?.([{ ...job, signal: controller.signal }]);
    controller.abort();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(true);
  });
});

describe('startWorker batch size', () => {
  it('fetches a queue named in TASK_WORKER_BATCH_LIMITS one job at a time and every other queue at the worker concurrency', async () => {
    const { boss, workOptions } = fakeBoss();
    await startWorker({
      boss,
      concurrency: 5,
      taskList: { noop: vi.fn(), 'sandbox.recreate_pinned': vi.fn() },
    });

    const batchSizes = new Map(
      [...workOptions].map(([name, options]) => [name, options.batchSize]),
    );
    expect(batchSizes).toEqual(
      new Map([
        ['noop', 5],
        ['sandbox.recreate_pinned', 1],
      ]),
    );
  });
});

describe('startWorker slot queues', () => {
  // Regression: a batch is fetched whole and awaited whole, so one website's
  // scan link (five to nine minutes) held every other site's queued scan —
  // a site added meanwhile sat on "Scanning · 0" until that link ended.
  it('works the website scan queue through one-job slots, as many as the worker concurrency', async () => {
    const { boss, workOptions } = fakeBoss();
    await startWorker({
      boss,
      concurrency: 5,
      taskList: { noop: vi.fn(), 'websites.scan': vi.fn() },
    });

    expect(workOptions.get('websites.scan')).toMatchObject({
      batchSize: 1,
      localConcurrency: 5,
    });
    // Every other queue keeps its batch, in one worker.
    expect(workOptions.get('noop')?.batchSize).toBe(5);
    expect(workOptions.get('noop')?.localConcurrency).toBeUndefined();
  });
});

describe('startWorker failure reporting', () => {
  it('fails a job the database restart caught for pg-boss to retry, and reports nothing', async () => {
    const { boss, handlers } = fakeBoss();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const terminated = Object.assign(
      new Error('terminating connection due to administrator command'),
      { code: '57P01' },
    );
    await startWorker({
      boss,
      taskList: { noop: vi.fn().mockRejectedValue(terminated) },
    });

    const results = await handlers.get('noop')?.([job]);

    expect(results).toEqual([
      {
        id: 'job-1',
        status: 'failed',
        output: {
          message: 'terminating connection due to administrator command',
        },
      },
    ]);
    expect(reportError).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[backend] task noop (job job-1) failed, database unavailable: 57P01 terminating connection due to administrator command',
    );
    warn.mockRestore();
    error.mockRestore();
  });

  it('still reports any other failure', async () => {
    const { boss, handlers } = fakeBoss();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const defect = new Error('undefined is not a function');
    await startWorker({
      boss,
      taskList: { noop: vi.fn().mockRejectedValue(defect) },
    });

    const results = await handlers.get('noop')?.([job]);

    expect(results?.[0]).toMatchObject({ id: 'job-1', status: 'failed' });
    expect(reportError).toHaveBeenCalledWith(defect, {
      tags: { 'tale.task': 'noop' },
      extra: { jobId: 'job-1' },
    });
    error.mockRestore();
  });
});
