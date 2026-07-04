// Job-card queries against a real in-memory DB (convexTest). The regression
// under guard: a LIVE job (still running, no tool result yet) must be
// discoverable from its PARENT thread with the spawning `toolCallId`, so the
// chat can anchor the card while `spawn_agent` is still executing — not only
// after the run completes. Auth mirrors the thread-owner / shared-org paths.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { api, internal } from '../_generated/api';
import schema from '../schema';

vi.mock('@convex-dev/agent', () => ({
  createThread: vi.fn(
    async () => `job-thread-${Math.random().toString(36).slice(2, 10)}`,
  ),
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

const ORG = 'org_jobs_query_test';
const PARENT_THREAD = 'parent-thread-q1';
const OWNER = 'user_owner';
const TOOL_CALL_ID = 'call_abc123';

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

/** Owned, non-shared parent thread + one running job spawned from it. */
async function seedRunningJob(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert('threadMetadata', {
      threadId: PARENT_THREAD,
      userId: OWNER,
      organizationId: ORG,
      chatType: 'general',
      status: 'active',
      createdAt: Date.now(),
    });
  });
  const started = await t.mutation(
    internal.agent_jobs.internal_mutations.startJob,
    {
      organizationId: ORG,
      threadId: PARENT_THREAD,
      parentAgentSlug: 'assistant',
      name: 'worker',
      description: 'test job',
      toolCallId: TOOL_CALL_ID,
      spec: SPEC,
    },
  );
  if (!started.started) throw new Error('expected start');
  return started;
}

describe('listForThread', () => {
  it('returns a STILL-RUNNING job with its spawning toolCallId', async () => {
    const t = convexTest(schema, modules);
    await seedRunningJob(t);

    const cards = await t
      .withIdentity({ subject: OWNER })
      .query(api.agent_jobs.queries.listForThread, {
        threadId: PARENT_THREAD,
        organizationId: ORG,
      });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      toolCallId: TOOL_CALL_ID,
      status: 'running',
      name: 'worker',
    });
  });

  it('returns [] for a non-owner on a non-shared thread', async () => {
    const t = convexTest(schema, modules);
    await seedRunningJob(t);

    const cards = await t
      .withIdentity({ subject: 'user_other' })
      .query(api.agent_jobs.queries.listForThread, {
        threadId: PARENT_THREAD,
        organizationId: ORG,
      });

    expect(cards).toEqual([]);
  });

  it('returns [] when the active org does not match the thread org', async () => {
    const t = convexTest(schema, modules);
    await seedRunningJob(t);

    const cards = await t
      .withIdentity({ subject: OWNER })
      .query(api.agent_jobs.queries.listForThread, {
        threadId: PARENT_THREAD,
        organizationId: 'org_other',
      });

    expect(cards).toEqual([]);
  });
});

describe('get', () => {
  it('returns the card (with toolCallId) for the thread owner', async () => {
    const t = convexTest(schema, modules);
    const started = await seedRunningJob(t);

    const card = await t
      .withIdentity({ subject: OWNER })
      .query(api.agent_jobs.queries.get, {
        jobId: started.jobId,
        organizationId: ORG,
      });

    expect(card).toMatchObject({
      _id: started.jobId,
      toolCallId: TOOL_CALL_ID,
      status: 'running',
    });
  });
});
