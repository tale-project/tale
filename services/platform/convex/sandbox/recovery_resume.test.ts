// claimRecoveryResume: the atomic single-claimant gate the restorative recovery
// watchdog uses before re-attaching a dead chain. ONE rule arbitrates every
// phase: the op's liveness lease (`sessionOpLastSignOfLifeMs` — heartbeat,
// finalize claim, terminal write, birth) must be silent past `staleBeforeMs`.
// It must reject while any signal is fresh, and claim each of the three
// dead-chain shapes: a stale drainer, a dead finalize winner (re-opening its
// election by clearing `finalizedAt`), and a settled op whose run-side settle
// died (latch only, status untouched). convexTest (real OCC over the row),
// mirroring session_lifecycle.test.ts.

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
const ORG = 'org_sbx';
const SID = 'usr-user_1-deadbeefdeadbeef';
const EXEC = 'exec-1';

async function insertOp(
  t: T,
  patch: Partial<{
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    heartbeatAt: number;
    finalizedAt: number;
    finishedAt: number;
    kind: string;
  }>,
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('sandboxSessionOps', {
      organizationId: ORG,
      sessionId: SID,
      execId: EXEC,
      kind: patch.kind ?? 'agent-run',
      status: patch.status ?? 'running',
      startedAt: 1_000,
      ...(patch.heartbeatAt !== undefined && {
        heartbeatAt: patch.heartbeatAt,
      }),
      ...(patch.finalizedAt !== undefined && {
        finalizedAt: patch.finalizedAt,
      }),
      ...(patch.finishedAt !== undefined && {
        finishedAt: patch.finishedAt,
      }),
    }),
  );
}

function opRow(t: T) {
  return t.run(async (ctx) => {
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', SID))) {
      if (row.execId === EXEC) return row;
    }
    return null;
  });
}

describe('claimRecoveryResume', () => {
  it('claims a running op with a stale heartbeat, bumping heartbeat + provenance', async () => {
    const t = convexTest(schema, modules);
    await insertOp(t, { status: 'running', heartbeatAt: 1_000 });
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(won).toBe(true);
    const row = await opRow(t);
    expect(row?.resumedBy).toBe('watchdog');
    expect(row?.heartbeatAt ?? 0).toBeGreaterThan(1_000); // bumped to now
  });

  it('rejects when the heartbeat is no longer stale (a live drainer bumped it)', async () => {
    const t = convexTest(schema, modules);
    await insertOp(t, { status: 'running', heartbeatAt: 9_999 });
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(won).toBe(false);
  });

  it('rejects a freshly-finalized op — its winner may still be settling', async () => {
    const t = convexTest(schema, modules);
    await insertOp(t, {
      status: 'running',
      heartbeatAt: 1_000,
      finalizedAt: 9_999,
    });
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(won).toBe(false);
  });

  it('rejects a freshly-settled op — the run-side settle may be mid-harvest', async () => {
    const t = convexTest(schema, modules);
    await insertOp(t, {
      status: 'completed',
      heartbeatAt: 1_000,
      finishedAt: 9_999,
    });
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(won).toBe(false);
  });

  it('only one of two concurrent claims wins (second sees the bumped heartbeat)', async () => {
    const t = convexTest(schema, modules);
    await insertOp(t, { status: 'running', heartbeatAt: 1_000 });
    const first = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    const second = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(first).toBe(true);
    expect(second).toBe(false); // heartbeat now bumped past staleBeforeMs
  });
});

describe('claimRecoveryResume — dead finalize winner (running + stale finalizedAt)', () => {
  it('takes the turn over and re-opens the election', async () => {
    const t = convexTest(schema, modules);
    await insertOp(t, {
      status: 'running',
      heartbeatAt: 1_000,
      finalizedAt: 2_000,
    });
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(won).toBe(true);
    const row = await opRow(t);
    expect(row?.status).toBe('running');
    expect(row?.finalizedAt).toBeUndefined(); // election re-opened
    expect(row?.resumedBy).toBe('watchdog');
    expect(row?.heartbeatAt ?? 0).toBeGreaterThan(1_000);
    // The resumed chain's own releaseTurnKey can now win the settle for real.
    const reElected = await t.mutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      { sessionId: SID, execId: EXEC },
    );
    expect(reElected).toBe(true);
    expect((await opRow(t))?.finalizedAt).toBeDefined();
  });

  it('a second sweep straight after the takeover is refused (heartbeat latch)', async () => {
    const t = convexTest(schema, modules);
    await insertOp(t, {
      status: 'running',
      heartbeatAt: 1_000,
      finalizedAt: 2_000,
    });
    const first = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    const second = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe('claimRecoveryResume — settled op whose run-side settle died', () => {
  it('latches the row without resurrecting the terminal status', async () => {
    const t = convexTest(schema, modules);
    await insertOp(t, {
      status: 'completed',
      heartbeatAt: 1_000,
      finalizedAt: 2_000,
      finishedAt: 2_000,
    });
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(won).toBe(true);
    const row = await opRow(t);
    expect(row?.status).toBe('completed'); // untouched — the op itself is done
    expect(row?.finalizedAt).toBeDefined(); // its election stays closed
    expect(row?.resumedBy).toBe('watchdog');
    // The latch: an immediate second sweep is refused via the fresh heartbeat.
    const second = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(second).toBe(false);
  });
});

describe('claimRecoveryResume — createMissing', () => {
  it('rejects a missing op row when no identity is supplied (the chat lane)', async () => {
    const t = convexTest(schema, modules);
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      { sessionId: SID, execId: EXEC, staleBeforeMs: 5_000 },
    );
    expect(won).toBe(false);
    expect(await opRow(t)).toBeNull();
  });

  it('claims a missing op row by creating it when the caller proves the turn', async () => {
    const t = convexTest(schema, modules);
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      {
        sessionId: SID,
        execId: EXEC,
        staleBeforeMs: 5_000,
        createMissing: {
          organizationId: ORG,
          kind: 'workflow-agent',
          deadlineMs: 99_000,
        },
      },
    );
    expect(won).toBe(true);
    const row = await opRow(t);
    expect(row).toMatchObject({
      organizationId: ORG,
      kind: 'workflow-agent',
      status: 'running',
      deadlineMs: 99_000,
      resumedBy: 'watchdog',
    });
    // The insert IS the claim: the fresh heartbeat makes a second sweep skip it.
    const again = await t.mutation(
      internal.sandbox.session_mutations.claimRecoveryResume,
      {
        sessionId: SID,
        execId: EXEC,
        staleBeforeMs: 5_000,
        createMissing: {
          organizationId: ORG,
          kind: 'workflow-agent',
          deadlineMs: 99_000,
        },
      },
    );
    expect(again).toBe(false);
  });
});
