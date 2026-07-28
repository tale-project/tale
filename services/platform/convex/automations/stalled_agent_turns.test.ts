/**
 * `listStalledAgentTurns` — the agent-turn watchdog's work list.
 *
 * The selection IS the safety property: a turn whose drive chain is still
 * mirroring must never be handed to recovery (two drainers would double-mirror
 * one exec), and a turn nobody is draining must never be missed (it sits until
 * its deadline fails a run whose agent may have finished long before). These
 * tests pin both edges, plus the shapes the watchdog must skip because they
 * carry no re-attachable turn. The claim that closes the query→schedule race is
 * pinned separately in `sandbox/recovery_resume.test.ts`.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'automations';
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
const ORG = 'org_watchdog';
const SID = 'usr-user_1-deadbeefdeadbeef';
const STALE_BEFORE = 10_000;

/** The cursor an agent-node park writes: everything a re-attach needs. */
function agentCursor(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    node: 'draft_return',
    index: 0,
    passes: 0,
    outs: [],
    agent: {
      execId: 'exec-1',
      sessionId: SID,
      harness: 'claude-code',
      gatewayModel: 'anthropic/claude-opus-5',
      deadlineAt: 9_999_999,
      ...patch,
    },
  };
}

async function seedRun(
  t: T,
  args: {
    status?: 'waiting' | 'running';
    cursor?: Record<string, unknown> | undefined;
  } = {},
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('automationRuns', {
      organizationId: ORG,
      name: 'vat-return-desk',
      version: 1,
      status: args.status ?? 'waiting',
      mode: 'live',
      input: {},
      startedAt: 1_000,
      startedBy: 'user:watchdog_test',
      checkpoints: {
        nodes: {},
        executions: 1,
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
      },
    }),
  );
}

async function seedOp(
  t: T,
  args: {
    status?: 'running' | 'completed';
    heartbeatAt?: number;
    execId?: string;
  } = {},
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('sandboxSessionOps', {
      organizationId: ORG,
      sessionId: SID,
      execId: args.execId ?? 'exec-1',
      kind: 'agent-run',
      status: args.status ?? 'running',
      startedAt: 1_000,
      ...(args.heartbeatAt !== undefined && { heartbeatAt: args.heartbeatAt }),
    }),
  );
}

function listStalled(t: T) {
  return t.query(internal.automations.queries.listStalledAgentTurns, {
    staleBeforeMs: STALE_BEFORE,
    limit: 25,
  });
}

describe('listStalledAgentTurns', () => {
  it('lists a parked turn whose op has gone silent, with the cursor a re-attach needs', async () => {
    const t = convexTest(schema, modules);
    await seedRun(t, { cursor: agentCursor() });
    await seedOp(t, { heartbeatAt: 1_000 });
    const stalled = await listStalled(t);
    expect(stalled).toHaveLength(1);
    expect(stalled[0]).toMatchObject({
      organizationId: ORG,
      nodeId: 'draft_return',
      execId: 'exec-1',
      sessionId: SID,
      harness: 'claude-code',
      gatewayModel: 'anthropic/claude-opus-5',
      // Split off the gateway ref — the drive action carries it separately.
      providerSlug: 'anthropic',
      deadlineAt: 9_999_999,
    });
  });

  it('leaves a turn whose drainer bumped the heartbeat inside the window', async () => {
    const t = convexTest(schema, modules);
    await seedRun(t, { cursor: agentCursor() });
    await seedOp(t, { heartbeatAt: STALE_BEFORE + 1 });
    expect(await listStalled(t)).toEqual([]);
  });

  it('counts a reaped op row as silent — nothing is draining it either', async () => {
    const t = convexTest(schema, modules);
    await seedRun(t, { cursor: agentCursor() });
    const stalled = await listStalled(t);
    expect(stalled).toHaveLength(1);
  });

  it('skips a turn whose op already settled — the stepper consumes that one', async () => {
    const t = convexTest(schema, modules);
    await seedRun(t, { cursor: agentCursor() });
    await seedOp(t, { status: 'completed', heartbeatAt: 1_000 });
    expect(await listStalled(t)).toEqual([]);
  });

  it('skips a turn whose result is already on the cursor', async () => {
    const t = convexTest(schema, modules);
    await seedRun(t, {
      cursor: agentCursor({ result: { status: 'ok', text: 'done' } }),
    });
    await seedOp(t, { heartbeatAt: 1_000 });
    expect(await listStalled(t)).toEqual([]);
  });

  it('ignores waits that are not agent turns (a repeat park has no agent cursor)', async () => {
    const t = convexTest(schema, modules);
    await seedRun(t, {
      cursor: { node: 'poll_status', index: 0, passes: 2, outs: [] },
    });
    expect(await listStalled(t)).toEqual([]);
  });

  it("ignores a healthy run — only `waiting` rows are the watchdog's business", async () => {
    const t = convexTest(schema, modules);
    await seedRun(t, { status: 'running', cursor: agentCursor() });
    await seedOp(t, { heartbeatAt: 1_000 });
    expect(await listStalled(t)).toEqual([]);
  });

  it('skips a cursor missing the fields a re-attach needs', async () => {
    const t = convexTest(schema, modules);
    await seedRun(t, { cursor: agentCursor({ deadlineAt: undefined }) });
    await seedOp(t, { heartbeatAt: 1_000 });
    expect(await listStalled(t)).toEqual([]);
  });

  it('honours the sweep limit', async () => {
    const t = convexTest(schema, modules);
    for (const execId of ['exec-1', 'exec-2', 'exec-3']) {
      await seedRun(t, { cursor: agentCursor({ execId }) });
      await seedOp(t, { execId, heartbeatAt: 1_000 });
    }
    const stalled = await t.query(
      internal.automations.queries.listStalledAgentTurns,
      { staleBeforeMs: STALE_BEFORE, limit: 2 },
    );
    expect(stalled).toHaveLength(2);
  });
});
