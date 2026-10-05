// @vitest-environment node

import type { Db, Job, JobResult, PgBoss, WorkOptions } from 'pg-boss';
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
  getQueue: ReturnType<typeof vi.fn>;
  calls: string[];
  handlers: Map<string, WorkHandler>;
  workOptions: Map<string, WorkOptions>;
} {
  const handlers = new Map<string, WorkHandler>();
  const workOptions = new Map<string, WorkOptions>();
  const calls: string[] = [];
  const send = vi.fn(async (): Promise<string | null> => {
    calls.push('send');
    return 'requeued';
  });
  // pg-boss 12's answer for one active job completed.
  const complete = vi.fn(async (): Promise<unknown> => {
    calls.push('complete');
    return { jobs: ['job-1'], requested: 1, affected: 1 };
  });
  const getQueue = vi.fn(
    async (name: string): Promise<{ name: string; policy: string } | null> => {
      calls.push('getQueue');
      return { name, policy: 'standard' };
    },
  );
  const boss = {
    work: vi.fn(
      async (name: string, options: WorkOptions, handler: WorkHandler) => {
        handlers.set(name, handler);
        workOptions.set(name, options);
      },
    ),
    send,
    complete,
    getQueue,
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    boss: boss as unknown as PgBoss,
    send,
    complete,
    getQueue,
    calls,
    handlers,
    workOptions,
  };
}

/** A pool whose one transaction records how it opened and ended; its
 * `unsafe` is what pg-boss's statements must run on. */
function fakeSql(calls: string[]): Sql & {
  tx: { unsafe: ReturnType<typeof vi.fn> };
} {
  const tx = { unsafe: vi.fn(async () => [{ count: '1' }]) };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return {
    tx,
    begin: async (body: (t: typeof tx) => Promise<unknown>) => {
      calls.push('begin');
      try {
        const result = await body(tx);
        calls.push('commit');
        return result;
      } catch (error) {
        calls.push('rollback');
        throw error;
      }
    },
  } as unknown as Sql & { tx: typeof tx };
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
  it('persists a successful handler result without deriving it from the job payload', async () => {
    const { boss, handlers } = fakeBoss();
    await startWorker({
      boss,
      taskList: {
        scan: async () => ({ output: { triggerScanCompleted: true } }),
      },
    });
    expect(await handlers.get('scan')?.([job])).toEqual([
      {
        id: job.id,
        status: 'completed',
        output: { triggerScanCompleted: true },
      },
    ]);
  });

  it('does not certify a handler result after its attempt is aborted', async () => {
    const { boss, handlers } = fakeBoss();
    const controller = new AbortController();
    await startWorker({
      boss,
      taskList: {
        scan: async () => {
          controller.abort();
          return { output: { triggerScanCompleted: true } };
        },
      },
    });
    expect(
      await handlers.get('scan')?.([{ ...job, signal: controller.signal }]),
    ).toEqual([{ id: job.id, status: 'completed' }]);
  });

  it('does not turn a failed scan or drain handover into a successful scan marker', async () => {
    const { boss, handlers, calls, complete } = fakeBoss();
    const handler = vi.fn(async () => {
      throw new Error('scan failed');
    });
    let draining = false;
    await startWorker({
      boss,
      taskList: { scan: handler },
      shouldDefer: async () => draining,
      sql: fakeSql(calls),
    });
    expect(await handlers.get('scan')?.([job])).toEqual([
      { id: job.id, status: 'failed', output: { message: 'scan failed' } },
    ]);
    draining = true;
    expect(await handlers.get('scan')?.([job])).toEqual([
      { id: job.id, status: 'completed' },
    ]);
    expect(handler).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith('scan', job.id, null, {
      db: expect.anything(),
    });
  });

  it('preserves the drain callback receiver through its timing span', async () => {
    const { boss, handlers, calls } = fakeBoss();
    const handler = vi.fn();
    const options = {
      boss,
      taskList: { noop: handler },
      sql: fakeSql(calls),
      shouldDefer() {
        expect(this).toBe(options);
        return Promise.resolve(false);
      },
    };
    await startWorker(options);
    expect(await handlers.get('noop')?.([job])).toEqual([
      { id: 'job-1', status: 'completed' },
    ]);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('hands a keyless job over — completed and re-queued five seconds out in one transaction — without running the handler', async () => {
    const { boss, send, complete, getQueue, calls, handlers, workOptions } =
      fakeBoss();
    const handler = vi.fn();
    const sql = fakeSql(calls);
    await startWorker({
      boss,
      taskList: { noop: handler },
      shouldDefer: async () => true,
      sql,
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
    expect(getQueue).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: 'job-1', status: 'completed' }]);

    // Both writes run on the transaction, through the enqueue adapter.
    const [, , , completion] = complete.mock.calls[0] as [
      string,
      string,
      null,
      { db: Db },
    ];
    const [, , sending] = send.mock.calls[0] as [string, object, { db: Db }];
    expect(completion.db).toBeTypeOf('object');
    await completion.db.executeSql('SELECT 1', [1]);
    await sending.db.executeSql('SELECT 2', [2]);
    expect(sql.tx.unsafe.mock.calls).toEqual([
      ['SELECT 1', [1]],
      ['SELECT 2', [2]],
    ]);
  });

  it('queues no successor for a claim that was no longer active — cancelled, or completed elsewhere — and changes nothing', async () => {
    const { boss, send, complete, getQueue, calls, handlers } = fakeBoss();
    // pg-boss completes active jobs only: its answer when the claim ended
    // before the hand-over.
    complete.mockImplementationOnce(async () => {
      calls.push('complete');
      return { jobs: ['job-1'], requested: 1, affected: 0 };
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = vi.fn();
    await startWorker({
      boss,
      taskList: { 'task.agent_retry_recheck': handler },
      shouldDefer: async () => true,
      sql: fakeSql(calls),
    });

    const results = await handlers.get('task.agent_retry_recheck')?.([
      {
        ...job,
        singletonKey: 'agent-retry:org-1:task-1:run-1',
      } as unknown as Job,
    ]);
    expect(calls).toEqual(['begin', 'complete', 'commit']);
    expect(send).not.toHaveBeenCalled();
    expect(getQueue).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    // pg-boss's own completion of the batch touches active jobs only, so
    // reporting it completed leaves the ended claim as it is.
    expect(results).toEqual([{ id: 'job-1', status: 'completed' }]);
    expect(log).toHaveBeenCalledWith(
      '[backend] task task.agent_retry_recheck (job job-1) not handed over: the claim was no longer active (cancelled, completed or expired)',
    );
    log.mockRestore();
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['no count', { jobs: ['job-1'], requested: 1 }],
    ['a count that is not a number', { jobs: ['job-1'], affected: '1' }],
    ['not a number', { jobs: ['job-1'], affected: Number.NaN }],
    ['two claims', { jobs: ['job-1'], requested: 1, affected: 2 }],
  ])(
    'rolls the hand-over back when the completion confirms no claim (%s) — no successor, the claim left to pg-boss',
    async (_case, answer) => {
      const { boss, send, complete, calls, handlers } = fakeBoss();
      complete.mockImplementationOnce(async () => {
        calls.push('complete');
        return answer;
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await startWorker({
        boss,
        taskList: { noop: vi.fn() },
        shouldDefer: async () => true,
        sql: fakeSql(calls),
      });

      const results = await handlers.get('noop')?.([job]);
      expect(calls).toEqual(['begin', 'complete', 'rollback']);
      expect(send).not.toHaveBeenCalled();
      expect(results?.[0]).toMatchObject({
        id: 'job-1',
        status: 'failed',
        output: {
          message: expect.stringContaining('the completion confirmed no claim'),
        },
      });
      error.mockRestore();
    },
  );

  it.each(['short', 'stately'])(
    'lets a refused successor collapse on a %s queue — the job already queued under its key does the work',
    async (policy) => {
      const { boss, send, getQueue, calls, handlers } = fakeBoss();
      send.mockResolvedValueOnce(null);
      getQueue.mockImplementationOnce(async (name: string) => {
        calls.push('getQueue');
        return { name, policy };
      });
      await startWorker({
        boss,
        taskList: { 'task.agent_retry_recheck': vi.fn() },
        shouldDefer: async () => true,
        sql: fakeSql(calls),
      });

      const results = await handlers.get('task.agent_retry_recheck')?.([
        {
          ...job,
          singletonKey: 'agent-retry:org-1:task-1:run-1',
        } as unknown as Job,
      ]);
      expect(calls).toEqual(['begin', 'complete', 'getQueue', 'commit']);
      expect(getQueue).toHaveBeenCalledWith('task.agent_retry_recheck');
      expect(results).toEqual([{ id: 'job-1', status: 'completed' }]);
    },
  );

  it.each([
    ['standard', 'standard'],
    ['exclusive', 'exclusive'],
    ['singleton', 'singleton'],
    ['key_strict_fifo', 'key_strict_fifo'],
    ['missing', null],
  ])(
    'rolls the hand-over back when a %s queue refuses the successor — the claim is not ended without one',
    async (_case, policy) => {
      const { boss, send, getQueue, calls, handlers } = fakeBoss();
      send.mockResolvedValueOnce(null);
      getQueue.mockImplementationOnce(async (name: string) => {
        calls.push('getQueue');
        return policy === null ? null : { name, policy };
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await startWorker({
        boss,
        taskList: { noop: vi.fn() },
        shouldDefer: async () => true,
        sql: fakeSql(calls),
      });

      const results = await handlers.get('noop')?.([job]);
      expect(calls).toEqual(['begin', 'complete', 'getQueue', 'rollback']);
      expect(results?.[0]).toMatchObject({
        id: 'job-1',
        status: 'failed',
        output: {
          message: `the hand-over queued no successor on queue noop (policy ${policy ?? 'unknown'})`,
        },
      });
      error.mockRestore();
    },
  );

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

  // A website scan link is told apart from a dead worker's by its job's
  // heartbeat, which the send that queued it set per job: the successor
  // has to carry it, or a scan handed over across a deploy loses it.
  it("keeps the job's heartbeat on its successor", async () => {
    const { boss, send, handlers } = fakeBoss();
    await startWorker({
      boss,
      taskList: { 'websites.scan': vi.fn() },
      shouldDefer: async () => true,
      sql: fakeSql([]),
    });

    await handlers.get('websites.scan')?.([
      { ...job, heartbeatSeconds: 60 } as unknown as Job,
    ]);
    expect(send).toHaveBeenCalledWith(
      'websites.scan',
      { seq: 1 },
      expect.objectContaining({ startAfter: 5, heartbeatSeconds: 60 }),
    );
  });

  it('keeps the claim when the hand-over fails, for pg-boss to retry', async () => {
    const { boss, send, calls, handlers } = fakeBoss();
    send.mockRejectedValueOnce(new Error('insert refused'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startWorker({
      boss,
      taskList: { noop: vi.fn() },
      shouldDefer: async () => true,
      sql: fakeSql(calls),
    });

    const results = await handlers.get('noop')?.([job]);
    expect(calls).toEqual(['begin', 'complete', 'rollback']);
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
  it.each(['websites.scan', 'chat.api_turn'] as const)(
    'works %s through independent one-job slots',
    async (queue) => {
      const { boss, workOptions } = fakeBoss();
      await startWorker({
        boss,
        concurrency: 5,
        taskList: { noop: vi.fn(), [queue]: vi.fn() },
      });

      expect(workOptions.get(queue)).toMatchObject({
        batchSize: 1,
        localConcurrency: 5,
      });
      // Every other queue keeps its batch, in one worker.
      expect(workOptions.get('noop')?.batchSize).toBe(5);
      expect(workOptions.get('noop')?.localConcurrency).toBeUndefined();
    },
  );
});

describe('startWorker agent turn slots', () => {
  // An agent turn's start and its 90 s drive windows ran in batches: one slow
  // start held the starts behind it, and a worker drained at most five live
  // turns at once — the rest waited, their output piling up in the sandbox.
  it('works agent starts and drives through slots, starts at least eight and drives sixteen at once', async () => {
    const { boss, workOptions } = fakeBoss();
    await startWorker({
      boss,
      concurrency: 5,
      taskList: {
        'task.agent_turn': vi.fn(),
        'task.agent_drive': vi.fn(),
        'automation.agent_turn': vi.fn(),
        'automation.agent_drive': vi.fn(),
      },
    });
    for (const start of ['task.agent_turn', 'automation.agent_turn']) {
      expect(workOptions.get(start)).toMatchObject({
        batchSize: 1,
        localConcurrency: 8,
      });
    }
    for (const drive of ['task.agent_drive', 'automation.agent_drive']) {
      expect(workOptions.get(drive)).toMatchObject({
        batchSize: 1,
        localConcurrency: 16,
        // Sixteen idle slots poll every ten seconds, not every two: a drive
        // is enqueued with no delay, so its insert notification wakes them.
        pollingIntervalSeconds: 10,
        notifyPollingIntervalSeconds: 10,
      });
    }
    expect(workOptions.get('task.agent_turn')).toMatchObject({
      pollingIntervalSeconds: 2,
    });
  });

  it('a higher worker concurrency raises the drive slots too', async () => {
    const { boss, workOptions } = fakeBoss();
    await startWorker({
      boss,
      concurrency: 32,
      taskList: { 'task.agent_drive': vi.fn() },
    });
    expect(workOptions.get('task.agent_drive')?.localConcurrency).toBe(32);
  });

  it('the operator sets the start and drive slots, whatever the worker concurrency', async () => {
    const { boss, workOptions } = fakeBoss();
    await startWorker({
      boss,
      concurrency: 5,
      agentStartSlots: 3,
      agentDriveSlots: 48,
      taskList: {
        'task.agent_turn': vi.fn(),
        'automation.agent_turn': vi.fn(),
        'task.agent_drive': vi.fn(),
        'automation.agent_drive': vi.fn(),
        'websites.scan': vi.fn(),
      },
    });
    expect(workOptions.get('task.agent_turn')?.localConcurrency).toBe(3);
    expect(workOptions.get('automation.agent_turn')?.localConcurrency).toBe(3);
    expect(workOptions.get('task.agent_drive')?.localConcurrency).toBe(48);
    expect(workOptions.get('automation.agent_drive')?.localConcurrency).toBe(
      48,
    );
    // Other slot queues keep the worker concurrency.
    expect(workOptions.get('websites.scan')?.localConcurrency).toBe(5);
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
