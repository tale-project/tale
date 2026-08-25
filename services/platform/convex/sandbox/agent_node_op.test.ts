// `getAgentNodeSandboxOp` — the read behind the run views' "Agent log". It is
// the only window into what an automation's `agent` node did inside the
// sandbox, so it must be org-gated, keyed to the RUN's own session, and must
// never surface another lane's op (a `run_code` exec) as agent activity.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { sessionIdForWorkflowExecution } from './session_naming';

const TEST_DIR_FROM_CONVEX_ROOT = 'sandbox';
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

const ORG = 'org_agentlog';
const OTHER_ORG = 'org_other';
const MEMBER = 'u_member';

type T = TestConvex<typeof schema>;

async function seedRun(t: T): Promise<Id<'automationRuns'>> {
  return t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${MEMBER}_${ORG}`,
      userId: MEMBER,
      organizationId: ORG,
      role: 'editor',
      createdAt: 0,
    });
    return await ctx.db.insert('automationRuns', {
      organizationId: ORG,
      name: 'doc-verify-desk',
      version: 1,
      status: 'running',
      mode: 'live',
      startedBy: `user:${MEMBER}`,
      input: {},
      startedAt: 0,
    });
  });
}

async function seedOp(
  t: T,
  runId: Id<'automationRuns'>,
  overrides: {
    kind?: string;
    organizationId?: string;
    liveTimeline?: { type: string; text?: string }[];
    progressText?: string;
    startedAt?: number;
    modelRef?: string;
  } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('sandboxSessionOps', {
      organizationId: overrides.organizationId ?? ORG,
      sessionId: sessionIdForWorkflowExecution(String(runId)),
      execId: `exec-${String(overrides.startedAt ?? 0)}`,
      kind: overrides.kind ?? 'workflow-agent',
      status: 'running',
      startedAt: overrides.startedAt ?? 0,
      ...(overrides.progressText !== undefined && {
        progressText: overrides.progressText,
      }),
      ...(overrides.liveTimeline !== undefined && {
        liveTimeline: overrides.liveTimeline,
      }),
      ...(overrides.modelRef !== undefined && {
        modelRef: overrides.modelRef,
      }),
    });
  });
}

describe('getAgentNodeSandboxOp', () => {
  it('returns the run sessionated agent op with its transcript', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t);
    await seedOp(t, runId, {
      progressText: 'reading the invoices',
      liveTimeline: [{ type: 'tool-Read', text: undefined }],
    });

    const op = await t
      .withIdentity({ subject: MEMBER })
      .query(api.sandbox.session_queries_public.getAgentNodeSandboxOp, {
        organizationId: ORG,
        runId,
      });
    expect(op).toMatchObject({
      status: 'running',
      progressText: 'reading the invoices',
      liveTimeline: [{ type: 'tool-Read' }],
    });
  });

  it('surfaces the serving the turn ran on, absent on pre-field rows', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t);
    await seedOp(t, runId, { startedAt: 1 });
    const bare = await t
      .withIdentity({ subject: MEMBER })
      .query(api.sandbox.session_queries_public.getAgentNodeSandboxOp, {
        organizationId: ORG,
        runId,
      });
    expect(bare?.modelRef).toBeUndefined();

    await seedOp(t, runId, {
      startedAt: 2,
      modelRef: 'openrouter/anthropic/claude-fable-5',
    });
    const op = await t
      .withIdentity({ subject: MEMBER })
      .query(api.sandbox.session_queries_public.getAgentNodeSandboxOp, {
        organizationId: ORG,
        runId,
      });
    expect(op?.modelRef).toBe('openrouter/anthropic/claude-fable-5');
  });

  it('ignores non-agent ops of the same session', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t);
    await seedOp(t, runId, { kind: 'exec', progressText: 'run_code output' });

    const op = await t
      .withIdentity({ subject: MEMBER })
      .query(api.sandbox.session_queries_public.getAgentNodeSandboxOp, {
        organizationId: ORG,
        runId,
      });
    expect(op).toBeNull();
  });

  it('prefers the newest agent op when a node re-ran', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t);
    await seedOp(t, runId, { startedAt: 1, progressText: 'first attempt' });
    await seedOp(t, runId, { startedAt: 2, progressText: 'second attempt' });

    const op = await t
      .withIdentity({ subject: MEMBER })
      .query(api.sandbox.session_queries_public.getAgentNodeSandboxOp, {
        organizationId: ORG,
        runId,
      });
    expect(op?.progressText).toBe('second attempt');
  });

  it('refuses a run belonging to another organization', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t);
    await seedOp(t, runId, { progressText: 'secret' });
    // A member of the OTHER org asking for this org's run: membership passes
    // (they belong to the org they name), the run's own org check refuses.
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${MEMBER}_${OTHER_ORG}`,
        userId: MEMBER,
        organizationId: OTHER_ORG,
        role: 'editor',
        createdAt: 0,
      });
    });

    const op = await t
      .withIdentity({ subject: MEMBER })
      .query(api.sandbox.session_queries_public.getAgentNodeSandboxOp, {
        organizationId: OTHER_ORG,
        runId,
      });
    expect(op).toBeNull();
  });

  it('returns null for an anonymous caller', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t);
    await seedOp(t, runId, { progressText: 'secret' });

    const op = await t.query(
      api.sandbox.session_queries_public.getAgentNodeSandboxOp,
      { organizationId: ORG, runId },
    );
    expect(op).toBeNull();
  });
});
