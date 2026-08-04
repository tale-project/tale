// Coverage for the session-op race-safety / recovery paths that drive the
// durable external-agent turn: the upsert hot path, the exactly-once finalize
// claim, the per-owner slot reservation, and the two recovery/resume queries.
// convexTest runs real OCC over the rows, mirroring recovery_resume.test.ts.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

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

type T = TestConvex<typeof schema>;
const ORG = 'org_cov';

function getOp(t: T, sessionId: string, execId: string) {
  return t.run((ctx) =>
    ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId_and_execId', (q) =>
        q.eq('sessionId', sessionId).eq('execId', execId),
      )
      .first(),
  );
}

describe('upsertSessionOp', () => {
  const base = {
    organizationId: ORG,
    sessionId: 'sid-1',
    execId: 'exec-1',
    kind: 'agent-run',
  };

  it('upserts in place on the same (sessionId, execId) — one row, patched not duplicated', async () => {
    const t = convexTest(schema, modules);
    const id1 = await t.mutation(
      internal.sandbox.session_mutations.upsertSessionOp,
      { ...base, status: 'running', progressText: 'first' },
    );
    const id2 = await t.mutation(
      internal.sandbox.session_mutations.upsertSessionOp,
      { ...base, status: 'running', progressText: 'second' },
    );
    expect(id2).toBe(id1);
    const rows = await t.run((ctx) =>
      ctx.db
        .query('sandboxSessionOps')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', 'sid-1'))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.progressText).toBe('second');
  });

  it('keeps visionModelRef through later flushes that omit it', async () => {
    // The vision model is written once at turn start and then rides every
    // throttled progress flush; the omit-preserves rule is what keeps it on
    // the row when a flush carries only text. Losing it would leave a settled
    // run unable to say which model read its images.
    const t = convexTest(schema, modules);
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      visionModelRef: 'openrouter/qwen/qwen3-vl-32b-instruct',
    });
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'completed',
      progressText: 'done',
    });
    const row = await getOp(t, 'sid-1', 'exec-1');
    expect(row?.visionModelRef).toBe('openrouter/qwen/qwen3-vl-32b-instruct');
  });

  it('merges a timeline flush into the stored transcript — a short fresh-window flush never wipes it', async () => {
    // Every drain window rebuilds its projection from scratch over the exec's
    // bounded ring buffer, so a new window's flush can carry one or two
    // entries where the row already holds dozens. Assignment wiped the row
    // down to the flush; the merge folds it in.
    const t = convexTest(schema, modules);
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      liveTimeline: [
        { type: 'text', text: 'working through the slides' },
        {
          type: 'tool-Read',
          state: 'input-available',
          toolCallId: 't1',
          input: { file_path: '/tmp/a.jpg' },
        },
      ],
    });
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      liveTimeline: [
        {
          type: 'tool-Read',
          state: 'output-available',
          toolCallId: 't1',
          input: { file_path: '/tmp/a.jpg' },
          output: 'ok',
        },
        {
          type: 'tool-Bash',
          state: 'input-available',
          toolCallId: 't2',
          input: { command: 'ls' },
        },
      ],
    });
    const row = await getOp(t, 'sid-1', 'exec-1');
    expect(row?.liveTimeline?.map((p) => p.toolCallId ?? 'text')).toEqual([
      'text',
      't1',
      't2',
    ]);
    expect(row?.liveTimeline?.[1]).toMatchObject({
      state: 'output-available',
      output: 'ok',
    });
  });

  it('keeps lastEventAt monotonic — a stale (smaller) value never regresses it', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      lastEventAt: 5_000,
    });
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      lastEventAt: 1_000, // out-of-order racer (500ms flush vs 20s heartbeat)
    });
    const row = await getOp(t, 'sid-1', 'exec-1');
    expect(row?.lastEventAt).toBe(5_000);
  });

  it('a settled op never returns to running — a late progress flush keeps its payload only', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      progressText: 'working',
    });
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'completed',
    });
    // The unawaited text/timeline flush lands AFTER the settle.
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      progressText: 'the last words of the turn',
      liveTimeline: [{ type: 'text', text: 'tail' }],
    });
    const row = await getOp(t, 'sid-1', 'exec-1');
    expect(row?.status).toBe('completed');
    expect(row?.progressText).toBe('the last words of the turn');
    expect(row?.liveTimeline).toEqual([{ type: 'text', text: 'tail' }]);
    expect(typeof row?.finishedAt).toBe('number');
  });

  it('agentIdle:true stamps agentIdleAt; a terminal status clears it and stamps finishedAt', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      agentIdle: true,
    });
    let row = await getOp(t, 'sid-1', 'exec-1');
    expect(typeof row?.agentIdleAt).toBe('number');
    expect(row?.finishedAt).toBeUndefined();

    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'completed',
    });
    row = await getOp(t, 'sid-1', 'exec-1');
    expect(row?.agentIdleAt).toBeUndefined();
    expect(typeof row?.finishedAt).toBe('number');
  });

  it('pendingBackgroundTasks>0 is stored; 0 clears; terminal clears', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      pendingBackgroundTasks: 2,
    });
    let row = await getOp(t, 'sid-1', 'exec-1');
    expect(row?.pendingBackgroundTasks).toBe(2);

    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      pendingBackgroundTasks: 0,
    });
    row = await getOp(t, 'sid-1', 'exec-1');
    expect(row?.pendingBackgroundTasks).toBeUndefined();

    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'running',
      pendingBackgroundTasks: 1,
    });
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      ...base,
      status: 'completed',
    });
    row = await getOp(t, 'sid-1', 'exec-1');
    expect(row?.pendingBackgroundTasks).toBeUndefined();
  });
});

describe('claimSessionOpFinalize', () => {
  it('first claim wins + stamps finalizedAt, a second loses, and a missing op loses', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: ORG,
      sessionId: 'sid-f',
      execId: 'exec-f',
      kind: 'agent-run',
      status: 'running',
    });
    const first = await t.mutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      { sessionId: 'sid-f', execId: 'exec-f' },
    );
    const second = await t.mutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      { sessionId: 'sid-f', execId: 'exec-f' },
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
    const row = await getOp(t, 'sid-f', 'exec-f');
    expect(typeof row?.finalizedAt).toBe('number');

    const missing = await t.mutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      { sessionId: 'nope', execId: 'nope' },
    );
    expect(missing).toBe(false);
  });
});

describe('reserveSessionSlotAndInsert', () => {
  it('inserts the first session, then rejects a second active session for the same owner', async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
      {
        organizationId: ORG,
        sessionId: 'sid-a',
        profile: 'agent',
        ownerType: 'thread',
        ownerId: 'thread-1',
        createdBy: 'user-1',
      },
    );
    expect(id).toBeTruthy();
    await expect(
      t.mutation(
        internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
        {
          organizationId: ORG,
          sessionId: 'sid-b',
          profile: 'agent',
          ownerType: 'thread',
          ownerId: 'thread-1',
          createdBy: 'user-1',
        },
      ),
    ).rejects.toThrow(/active sandbox session/);
  });

  it('a terminal (destroyed) session for the same owner does NOT count toward the per-owner cap', async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
      {
        organizationId: ORG,
        sessionId: 'sid-a',
        profile: 'agent',
        ownerType: 'thread',
        ownerId: 'thread-2',
        createdBy: 'user-1',
      },
    );
    await t.run((ctx) => ctx.db.patch(id, { status: 'destroyed' }));
    // The terminal row is no longer active, so a fresh reserve succeeds.
    const id2 = await t.mutation(
      internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
      {
        organizationId: ORG,
        sessionId: 'sid-c',
        profile: 'agent',
        ownerType: 'thread',
        ownerId: 'thread-2',
        createdBy: 'user-1',
      },
    );
    expect(id2).toBeTruthy();
  });
});
