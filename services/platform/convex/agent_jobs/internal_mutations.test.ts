// Job lifecycle against a real in-memory DB (convexTest): transactional
// admission math, orphan self-heal on the over-cap path, finalize idempotency
// + counter floor, opId dedup, message linking, and GC terminal-only
// eligibility. The two component seams are mocked: `createThread` (agent
// component — unavailable under convexTest) and the rate limiter (component
// client) so `maybeCleanupJobs` always passes its gate here.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { JOBS_COUNTER_SCOPE } from './internal_mutations';

vi.mock('@convex-dev/agent', () => ({
  createThread: vi.fn(
    async () => `job-thread-${Math.random().toString(36).slice(2, 10)}`,
  ),
}));

vi.mock('../lib/rate_limiter', () => ({
  rateLimiter: { limit: vi.fn(async () => ({ ok: true })) },
}));

vi.mock('./delete_job_thread', () => ({
  deleteJobThread: vi.fn(async () => undefined),
}));

const TEST_DIR_FROM_CONVEX_ROOT = 'agent_jobs';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

type T = TestConvex<typeof schema>;

const ORG = 'org_jobs_test';
const PARENT_THREAD = 'parent-thread-1';

const SPEC = {
  instructions: 'do the thing',
  input: 'the task',
  requestedTools: ['web'],
  effectiveTools: ['web', 'update_progress'],
  skills: [],
  integrations: [],
  model: 'openrouter:anthropic/claude-sonnet-4.6',
  narrowed: { tools: [], skills: [], integrations: [] },
};

function startArgs(name = 'worker') {
  return {
    organizationId: ORG,
    threadId: PARENT_THREAD,
    parentAgentSlug: 'assistant',
    name,
    description: 'test job',
    spec: SPEC,
  };
}

async function runningCount(t: T): Promise<number> {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query('agentRunCounters')
      .withIndex('by_org_scope', (q) =>
        q.eq('organizationId', ORG).eq('scope', JOBS_COUNTER_SCOPE),
      )
      .first();
    return row?.running ?? 0;
  });
}

describe('startJob admission', () => {
  it('admits under the cap and increments the counter', async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.agent_jobs.internal_mutations.startJob,
      startArgs(),
    );
    expect(result.started).toBe(true);
    expect(await runningCount(t)).toBe(1);
  });

  it('refuses over the cap with a typed reason', async () => {
    const t = convexTest(schema, modules);
    // Default policy cap is 10 (no policy row in configCache → schema default).
    for (let i = 0; i < 10; i++) {
      const r = await t.mutation(
        internal.agent_jobs.internal_mutations.startJob,
        startArgs(`w${i}`),
      );
      expect(r.started).toBe(true);
    }
    const over = await t.mutation(
      internal.agent_jobs.internal_mutations.startJob,
      startArgs('overflow'),
    );
    expect(over).toMatchObject({
      started: false,
      reason: 'JOB_CONCURRENCY',
      running: 10,
      cap: 10,
    });
  });

  it('self-heals orphaned running rows on the over-cap path', async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 10; i++) {
      await t.mutation(
        internal.agent_jobs.internal_mutations.startJob,
        startArgs(`w${i}`),
      );
    }
    // Age every running row past the stuck threshold (default 1h).
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('agentJobs').collect();
      for (const row of rows) {
        await ctx.db.patch(row._id, {
          startedAt: Date.now() - 2 * 60 * 60 * 1000,
        });
      }
    });
    const result = await t.mutation(
      internal.agent_jobs.internal_mutations.startJob,
      startArgs('after-heal'),
    );
    expect(result.started).toBe(true);
    // All 10 orphans flipped to timed_out; only the new job is running.
    expect(await runningCount(t)).toBe(1);
    const orphaned = await t.run((ctx) =>
      ctx.db
        .query('agentJobs')
        .withIndex('by_org_status_completed', (q) =>
          q.eq('organizationId', ORG).eq('status', 'timed_out'),
        )
        .collect(),
    );
    expect(orphaned).toHaveLength(10);
    expect(orphaned[0]?.failureReason).toBe('orphaned');
  });
});

describe('finalizeJob', () => {
  it('is idempotent and floors the counter at 0', async () => {
    const t = convexTest(schema, modules);
    const started = await t.mutation(
      internal.agent_jobs.internal_mutations.startJob,
      startArgs(),
    );
    if (!started.started) throw new Error('expected start');

    const first = await t.mutation(
      internal.agent_jobs.internal_mutations.finalizeJob,
      {
        jobId: started.jobId,
        status: 'completed',
        resultText: 'done',
        costCents: 3,
      },
    );
    expect(first.finalized).toBe(true);
    expect(await runningCount(t)).toBe(0);

    const second = await t.mutation(
      internal.agent_jobs.internal_mutations.finalizeJob,
      { jobId: started.jobId, status: 'failed' },
    );
    expect(second.finalized).toBe(false);
    expect(await runningCount(t)).toBe(0);

    const job = await t.run((ctx) => ctx.db.get(started.jobId));
    expect(job).toMatchObject({
      status: 'completed',
      resultText: 'done',
      costCents: 3,
    });
    expect(job?.completedAt).toBeDefined();
  });
});

describe('applyProgressOperations', () => {
  it('applies batches keyed by jobThreadId and dedupes by opId', async () => {
    const t = convexTest(schema, modules);
    const started = await t.mutation(
      internal.agent_jobs.internal_mutations.startJob,
      startArgs(),
    );
    if (!started.started) throw new Error('expected start');

    const first = await t.mutation(
      internal.agent_jobs.internal_mutations.applyProgressOperations,
      {
        jobThreadId: started.jobThreadId,
        opId: 'op-1',
        operations: [
          { type: 'add', id: 'q1', content: 'research A' },
          { type: 'update', id: 'q1', status: 'in_progress' },
        ],
      },
    );
    expect(first).toMatchObject({ success: true, activeProgressId: 'q1' });

    const replay = await t.mutation(
      internal.agent_jobs.internal_mutations.applyProgressOperations,
      {
        jobThreadId: started.jobThreadId,
        opId: 'op-1',
        operations: [{ type: 'add', id: 'q9', content: 'replayed' }],
      },
    );
    expect(replay).toMatchObject({ success: true, deduplicated: true });
    if (!replay.success) return;
    expect(replay.progress.map((p) => p.id)).toEqual(['q1']);
  });

  it('refuses when the job is not running', async () => {
    const t = convexTest(schema, modules);
    const started = await t.mutation(
      internal.agent_jobs.internal_mutations.startJob,
      startArgs(),
    );
    if (!started.started) throw new Error('expected start');
    await t.mutation(internal.agent_jobs.internal_mutations.finalizeJob, {
      jobId: started.jobId,
      status: 'cancelled',
    });
    const result = await t.mutation(
      internal.agent_jobs.internal_mutations.applyProgressOperations,
      {
        jobThreadId: started.jobThreadId,
        opId: 'op-2',
        operations: [{ type: 'add', id: 'q1', content: 'late' }],
      },
    );
    expect(result).toMatchObject({ success: false, code: 'job_not_running' });
  });
});

describe('maybeCleanupJobs', () => {
  it('deletes only terminal rows past the TTL', async () => {
    const t = convexTest(schema, modules);
    const done = await t.mutation(
      internal.agent_jobs.internal_mutations.startJob,
      startArgs('old-done'),
    );
    const live = await t.mutation(
      internal.agent_jobs.internal_mutations.startJob,
      startArgs('live'),
    );
    if (!done.started || !live.started) throw new Error('expected starts');
    await t.mutation(internal.agent_jobs.internal_mutations.finalizeJob, {
      jobId: done.jobId,
      status: 'completed',
    });
    // Age the terminal row past the 30d TTL.
    await t.run(async (ctx) => {
      await ctx.db.patch(done.jobId, {
        completedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      });
    });

    await t.mutation(internal.agent_jobs.internal_mutations.maybeCleanupJobs, {
      organizationId: ORG,
    });

    const rows = await t.run((ctx) => ctx.db.query('agentJobs').collect());
    expect(rows.map((r) => r.name)).toEqual(['live']);
  });
});
