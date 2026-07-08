import { beforeEach, describe, expect, it, vi } from 'vitest';

// External-run state machine, tested at the handler level with the mock-ctx
// idiom of erasure_collab_passes.test.ts. The contracts under test are the
// task-ops cross-pillar ones: complete hard-codes in_review and closes the
// unified metrics row; lease expiry requeues until the attempt cap; the
// dispatch deadline fails quietly-queued runs; claims are daemon-pinned.

vi.mock('../_generated/api', () => ({
  internal: {
    task_metrics: {
      internal_mutations: {
        startTaskAgentRun: 'task_metrics:start',
        recordTaskRunUsage: 'task_metrics:usage',
        finalizeTaskAgentRun: 'task_metrics:finalize',
      },
    },
    tasks: {
      internal_mutations: {
        agentAddComment: 'tasks:comment',
        agentUpdateTaskStatus: 'tasks:status',
      },
    },
    external_runs: {
      internal_mutations: { sweepExternalRuns: 'external:sweep' },
    },
  },
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

const mockGuard = vi.fn(async () => ({ allowed: true, budgetState: 'none' }));
vi.mock('../agents/guardrails/budget_guard', () => ({
  checkAgentRunAllowedHelper: () => mockGuard(),
}));

const mockEmitEvent = vi.fn(async () => undefined);
vi.mock('../workflows/triggers/emit_event', () => ({
  emitEvent: () => mockEmitEvent(),
}));

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows the runtime shape to { handler }
type Handler = { handler: (...args: unknown[]) => Promise<any> };
async function loadModule(): Promise<Record<string, Handler>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return (await import('./internal_mutations')) as unknown as Record<
    string,
    Handler
  >;
}

interface DbRow {
  _id: string;
  [k: string]: unknown;
}

function buildQueryRunner(rows: DbRow[]) {
  let active: Record<string, unknown> = {};
  const builder = {
    withIndex: (
      _name: string,
      fn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      const filter: Record<string, unknown> = {};
      const q = {
        eq(field: string, value: unknown) {
          filter[field] = value;
          return q;
        },
      };
      fn(q);
      active = filter;
      return builder;
    },
    [Symbol.asyncIterator]: () => {
      const matches = rows.filter((r) =>
        Object.entries(active).every(([k, v]) => r[k] === v),
      );
      let i = 0;
      return {
        async next() {
          if (i >= matches.length) {
            return { value: undefined as never, done: true };
          }
          return { value: matches[i++], done: false };
        },
      };
    },
  };
  return builder;
}

function createMockCtx(tables: Record<string, DbRow[]>) {
  const all = Object.values(tables).flat();
  const runMutationCalls: Array<{ ref: unknown; args: unknown }> = [];
  const inserted: Array<{ table: string; doc: Record<string, unknown> }> = [];
  const scheduled: Array<{ delay: number; ref: unknown }> = [];
  const ctx = {
    db: {
      query: vi.fn((table: string) => buildQueryRunner(tables[table] ?? [])),
      get: vi.fn(async (id: string) => all.find((r) => r._id === id) ?? null),
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        const row = all.find((r) => r._id === id);
        if (row) Object.assign(row, patch);
      }),
      insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
        inserted.push({ table, doc });
        return `${table}:${inserted.length}`;
      }),
    },
    runMutation: vi.fn(async (ref: unknown, args: unknown) => {
      runMutationCalls.push({ ref, args });
      if (ref === 'task_metrics:start') {
        return { started: true, runId: 'metricsRun1' };
      }
      return { commentId: 'c1', mentionCount: 0, ok: true };
    }),
    scheduler: {
      runAfter: vi.fn(async (delay: number, ref: unknown) => {
        scheduled.push({ delay, ref });
      }),
    },
  };
  return { ctx, runMutationCalls, inserted, scheduled };
}

function queuedRun(over: Partial<DbRow> = {}): DbRow {
  return {
    _id: 'run1',
    organizationId: 'org1',
    taskId: 'task1',
    projectId: 'proj1',
    agentSlug: 'coder',
    adapterType: 'claude_code',
    permissionMode: 'safe',
    kind: 'initial',
    trigger: 'assignment',
    prompt: 'do the work',
    status: 'queued',
    attempts: 0,
    maxAttempts: 2,
    createdAt: 1_000,
    dispatchDeadlineAt: Date.now() + 60_000,
    ...over,
  };
}

const openTask: DbRow = {
  _id: 'task1',
  organizationId: 'org1',
  projectId: 'proj1',
  title: 'T',
  status: 'in_progress',
};

beforeEach(() => {
  mockGuard.mockClear();
  mockEmitEvent.mockClear();
});

describe('claimExternalRun', () => {
  it('hands out the oldest eligible run, admits through startTaskAgentRun, and leases it', async () => {
    const run = queuedRun();
    const { ctx, runMutationCalls } = createMockCtx({
      externalRuns: [run],
      tasks: [openTask],
    });
    const mod = await loadModule();
    const result = await mod.claimExternalRun.handler(ctx, {
      organizationId: 'org1',
      daemonId: 'd1',
      adapterTypes: ['claude_code'],
    });
    expect(result?.externalRunId).toBe('run1');
    expect(result?.prompt).toBe('do the work');
    expect(run.status).toBe('claimed');
    expect(run.claimedByDaemonId).toBe('d1');
    expect(run.attempts).toBe(1);
    expect(run.runId).toBe('metricsRun1');
    expect(typeof run.leaseExpiresAt).toBe('number');
    expect(runMutationCalls.some((c) => c.ref === 'task_metrics:start')).toBe(
      true,
    );
  });

  it('skips runs pinned to another daemon and wrong adapters', async () => {
    const pinned = queuedRun({ _id: 'run2', daemonId: 'other' });
    const wrongAdapter = queuedRun({ _id: 'run3', adapterType: 'codex' });
    const { ctx } = createMockCtx({
      externalRuns: [pinned, wrongAdapter],
      tasks: [openTask],
    });
    const mod = await loadModule();
    const result = await mod.claimExternalRun.handler(ctx, {
      organizationId: 'org1',
      daemonId: 'd1',
      adapterTypes: ['claude_code'],
    });
    expect(result).toBeNull();
    expect(pinned.status).toBe('queued');
  });

  it('leaves guard-refused runs queued (capped agents wait, never fail)', async () => {
    mockGuard.mockResolvedValueOnce({
      allowed: false,
      reason: 'agent_concurrency',
      budgetState: 'none',
      // oxlint-disable-next-line typescript/no-explicit-any -- partial verdict for the mock
    } as any);
    const run = queuedRun();
    const { ctx } = createMockCtx({
      externalRuns: [run],
      tasks: [openTask],
    });
    const mod = await loadModule();
    const result = await mod.claimExternalRun.handler(ctx, {
      organizationId: 'org1',
      daemonId: 'd1',
      adapterTypes: ['claude_code'],
    });
    expect(result).toBeNull();
    expect(run.status).toBe('queued');
  });
});

describe('completeExternalRun', () => {
  it('hard-codes in_review, closes the metrics row, and posts the result comment', async () => {
    const run = queuedRun({
      status: 'running',
      claimedByDaemonId: 'd1',
      runId: 'metricsRun1',
    });
    const { ctx, runMutationCalls } = createMockCtx({
      externalRuns: [run],
      tasks: [openTask],
    });
    const mod = await loadModule();
    const result = await mod.completeExternalRun.handler(ctx, {
      organizationId: 'org1',
      daemonId: 'd1',
      externalRunId: 'run1',
      summary: 'did it',
      diffStat: '1 file changed',
      costCents: 42,
    });
    expect(result.ok).toBe(true);
    expect(run.status).toBe('completed');

    const statusArgs = runMutationCalls.find((c) => c.ref === 'tasks:status')
      ?.args as { status?: string; actorId?: string } | undefined;
    expect(statusArgs?.status).toBe('in_review');
    expect(statusArgs?.actorId).toBe('workflow');
    expect(
      runMutationCalls.some((c) => c.ref === 'task_metrics:finalize'),
    ).toBe(true);
    expect(runMutationCalls.some((c) => c.ref === 'tasks:comment')).toBe(true);
  });

  it('rejects a daemon that does not hold the claim', async () => {
    const run = queuedRun({ status: 'running', claimedByDaemonId: 'd1' });
    const { ctx } = createMockCtx({
      externalRuns: [run],
      tasks: [openTask],
    });
    const mod = await loadModule();
    const result = await mod.completeExternalRun.handler(ctx, {
      organizationId: 'org1',
      daemonId: 'intruder',
      externalRunId: 'run1',
      summary: 'nope',
    });
    expect(result.ok).toBe(false);
    expect(run.status).toBe('running');
  });
});

describe('sweepExternalRuns', () => {
  it('fails queued runs past the dispatch deadline and rolls the task back', async () => {
    const run = queuedRun({ dispatchDeadlineAt: Date.now() - 1_000 });
    const { ctx, runMutationCalls } = createMockCtx({
      externalRuns: [run],
      tasks: [openTask],
    });
    const mod = await loadModule();
    await mod.sweepExternalRuns.handler(ctx, { organizationId: 'org1' });
    expect(run.status).toBe('failed');
    expect(run.failReason).toBe('runtime_offline');
    const statusArgs = runMutationCalls.find((c) => c.ref === 'tasks:status')
      ?.args as { status?: string } | undefined;
    expect(statusArgs?.status).toBe('todo');
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
  });

  it('requeues a lease-expired claim below the attempt cap, fails at the cap', async () => {
    const belowCap = queuedRun({
      _id: 'runA',
      status: 'claimed',
      claimedByDaemonId: 'd1',
      attempts: 1,
      leaseExpiresAt: Date.now() - 1_000,
      runId: 'metricsRun1',
    });
    const atCap = queuedRun({
      _id: 'runB',
      taskId: 'task1',
      status: 'claimed',
      claimedByDaemonId: 'd1',
      attempts: 2,
      leaseExpiresAt: Date.now() - 1_000,
    });
    const { ctx } = createMockCtx({
      externalRuns: [belowCap, atCap],
      tasks: [openTask],
    });
    const mod = await loadModule();
    await mod.sweepExternalRuns.handler(ctx, { organizationId: 'org1' });
    expect(belowCap.status).toBe('queued');
    expect(belowCap.claimedByDaemonId).toBeUndefined();
    expect(belowCap.runId).toBeUndefined();
    expect(atCap.status).toBe('failed');
    expect(atCap.failReason).toBe('lease_expired');
  });
});
