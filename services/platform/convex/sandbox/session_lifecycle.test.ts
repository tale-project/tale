// Session-lifecycle reads/writes against the reused deterministic sessionId.
//
// The per-(org,user) sessionId is reused across create/destroy incarnations,
// so `by_sessionId` yields historical terminal rows oldest-first. Every
// function here must skip them and act on the LIVE row — the management-page
// Destroy regression (success toast, row survives refresh) came from an early
// return on the oldest destroyed row. convexTest (not the vi.mock pattern of
// the sibling test files) because index iteration order IS the hazard.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives
// at convex/sandbox/, so resolve glob keys against that base.
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
const OTHER_ORG = 'org_other';
// Deterministic-id shaped; the exact format doesn't matter to the functions.
const SID = 'usr-user_1-deadbeefdeadbeef';

type SessionStatus = Doc<'sandboxSessions'>['status'];

/** Insert an incarnation row. createdAt orders incarnations (older first in
 * the by_sessionId scan via the _creationTime tiebreak on insertion order). */
async function insertSession(
  t: T,
  overrides: {
    status: SessionStatus;
    organizationId?: string;
    createdAt?: number;
    pinned?: boolean;
    sessionId?: string;
    ownerType?: string;
    ownerId?: string;
  },
) {
  const createdAt = overrides.createdAt ?? 0;
  return t.run((ctx) =>
    ctx.db.insert('sandboxSessions', {
      organizationId: overrides.organizationId ?? ORG,
      sessionId: overrides.sessionId ?? SID,
      profile: 'agent',
      status: overrides.status,
      ownerType: overrides.ownerType ?? 'user',
      ownerId: overrides.ownerId ?? 'user_1',
      createdBy: 'user_1',
      agentKind: 'claude-code',
      createdAt,
      expiresAt: createdAt + 86_400_000,
      ...(overrides.status === 'destroyed' || overrides.status === 'expired'
        ? { destroyedAt: createdAt + 1 }
        : {}),
      ...(overrides.pinned !== undefined && { pinned: overrides.pinned }),
    }),
  );
}

async function allSessions(t: T): Promise<Doc<'sandboxSessions'>[]> {
  return t.run((ctx) => ctx.db.query('sandboxSessions').collect());
}

describe('markSessionRowDestroyed', () => {
  it('flips the live row even when older terminal incarnations share the sessionId', async () => {
    const t = convexTest(schema, modules);
    // Insertion order = index order: the regression had the oldest destroyed
    // row early-returning false before the live row was ever reached.
    await insertSession(t, { status: 'destroyed', createdAt: 0 });
    await insertSession(t, { status: 'expired', createdAt: 10 });
    const liveId = await insertSession(t, { status: 'active', createdAt: 20 });

    const destroyed = await t.mutation(
      internal.sandbox.session_mutations.markSessionRowDestroyed,
      { organizationId: ORG, sessionId: SID },
    );
    expect(destroyed).toBe(true);

    const rows = await allSessions(t);
    const live = rows.find((r) => r._id === liveId);
    expect(live?.status).toBe('destroyed');
    expect(live?.destroyedAt).toBeGreaterThan(0);
    // Historical rows untouched (destroyedAt = createdAt + 1 from the fixture).
    expect(rows.find((r) => r.createdAt === 0)?.destroyedAt).toBe(1);
    expect(rows.find((r) => r.createdAt === 10)?.status).toBe('expired');
    expect(rows.find((r) => r.createdAt === 10)?.destroyedAt).toBe(11);
  });

  it('flips a degraded row (the page lists degraded sandboxes as manageable)', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, { status: 'destroyed', createdAt: 0 });
    const liveId = await insertSession(t, {
      status: 'degraded',
      createdAt: 10,
    });

    const destroyed = await t.mutation(
      internal.sandbox.session_mutations.markSessionRowDestroyed,
      { organizationId: ORG, sessionId: SID },
    );
    expect(destroyed).toBe(true);
    const rows = await allSessions(t);
    expect(rows.find((r) => r._id === liveId)?.status).toBe('destroyed');
  });

  it('returns false and touches nothing when only terminal rows exist', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, { status: 'destroyed', createdAt: 0 });
    await insertSession(t, { status: 'failed', createdAt: 10 });

    const destroyed = await t.mutation(
      internal.sandbox.session_mutations.markSessionRowDestroyed,
      { organizationId: ORG, sessionId: SID },
    );
    expect(destroyed).toBe(false);

    const rows = await allSessions(t);
    expect(rows.find((r) => r.createdAt === 0)?.status).toBe('destroyed');
    const failed = rows.find((r) => r.createdAt === 10);
    expect(failed?.status).toBe('failed');
    expect(failed?.destroyedAt).toBeUndefined();
  });

  it("never flips another org's live row for the same sessionId", async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, {
      status: 'active',
      organizationId: OTHER_ORG,
      createdAt: 0,
    });

    const destroyed = await t.mutation(
      internal.sandbox.session_mutations.markSessionRowDestroyed,
      { organizationId: ORG, sessionId: SID },
    );
    expect(destroyed).toBe(false);
    expect((await allSessions(t))[0]?.status).toBe('active');
  });
});

describe('getSessionBySessionId', () => {
  it('returns the live row, skipping older terminal incarnations', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, { status: 'destroyed', createdAt: 0 });
    await insertSession(t, { status: 'active', createdAt: 20 });

    const row = await t.query(
      internal.sandbox.session_queries.getSessionBySessionId,
      { sessionId: SID },
    );
    expect(row).toMatchObject({ organizationId: ORG, status: 'active' });
  });

  it('returns null when only terminal incarnations exist', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, { status: 'destroyed', createdAt: 0 });
    await insertSession(t, { status: 'expired', createdAt: 10 });

    const row = await t.query(
      internal.sandbox.session_queries.getSessionBySessionId,
      { sessionId: SID },
    );
    expect(row).toBeNull();
  });
});

describe('setSessionPinned', () => {
  it('pins a degraded row past older terminal incarnations', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, { status: 'destroyed', createdAt: 0 });
    const liveId = await insertSession(t, {
      status: 'degraded',
      createdAt: 10,
    });

    await t.mutation(internal.sandbox.session_mutations.setSessionPinned, {
      organizationId: ORG,
      sessionId: SID,
      pinned: true,
    });

    const rows = await allSessions(t);
    const live = rows.find((r) => r._id === liveId);
    expect(live?.pinned).toBe(true);
    expect(live?.pinnedAt).toBeGreaterThan(0);
    // Pinned = exempt from the hard TTL: pushed out years, not the 24h window.
    expect(live?.expiresAt).toBeGreaterThan(Date.now() + 365 * 86_400_000);
    const historical = rows.find((r) => r.createdAt === 0);
    expect(historical?.pinned).toBeUndefined();
  });

  it('unpin restores a normal lifetime', async () => {
    const t = convexTest(schema, modules);
    const liveId = await insertSession(t, {
      status: 'active',
      createdAt: 0,
      pinned: true,
    });

    await t.mutation(internal.sandbox.session_mutations.setSessionPinned, {
      organizationId: ORG,
      sessionId: SID,
      pinned: false,
    });

    const rows = await allSessions(t);
    const live = rows.find((r) => r._id === liveId);
    expect(live?.pinned).toBe(false);
    expect(live?.pinnedAt).toBeUndefined();
    expect(live?.expiresAt).toBeLessThan(Date.now() + 2 * 86_400_000);
  });

  it('does not pin a same-id row owned by another org', async () => {
    const t = convexTest(schema, modules);
    const liveId = await insertSession(t, {
      status: 'active',
      createdAt: 0,
      organizationId: OTHER_ORG,
    });

    await t.mutation(internal.sandbox.session_mutations.setSessionPinned, {
      organizationId: ORG,
      sessionId: SID,
      pinned: true,
    });

    const rows = await allSessions(t);
    const other = rows.find((r) => r._id === liveId);
    expect(other?.pinned).toBeUndefined();
  });
});

describe('markSessionRowStopped', () => {
  it('flips the live active row to stopped WITHOUT a destroyedAt (hibernation)', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, { status: 'destroyed', createdAt: 0 });
    const liveId = await insertSession(t, { status: 'active', createdAt: 20 });

    const stopped = await t.mutation(
      internal.sandbox.session_mutations.markSessionRowStopped,
      { organizationId: ORG, sessionId: SID },
    );
    expect(stopped).toBe(true);
    const live = (await allSessions(t)).find((r) => r._id === liveId);
    expect(live?.status).toBe('stopped');
    // Hibernation is not teardown — the destroyedAt stamp must stay unset so the
    // row is never read as terminal.
    expect(live?.destroyedAt).toBeUndefined();
  });

  it('skips a pinned row (always-on is never reaped)', async () => {
    const t = convexTest(schema, modules);
    const liveId = await insertSession(t, {
      status: 'active',
      createdAt: 0,
      pinned: true,
    });
    const stopped = await t.mutation(
      internal.sandbox.session_mutations.markSessionRowStopped,
      { organizationId: ORG, sessionId: SID },
    );
    expect(stopped).toBe(false);
    expect((await allSessions(t)).find((r) => r._id === liveId)?.status).toBe(
      'active',
    );
  });

  it("never flips another org's row", async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, {
      status: 'active',
      organizationId: OTHER_ORG,
      createdAt: 0,
    });
    const stopped = await t.mutation(
      internal.sandbox.session_mutations.markSessionRowStopped,
      { organizationId: ORG, sessionId: SID },
    );
    expect(stopped).toBe(false);
    expect((await allSessions(t))[0]?.status).toBe('active');
  });
});

describe('resumeStoppedSession', () => {
  it('flips stopped → active, PRESERVING createdAt (for --resume continuity)', async () => {
    const t = convexTest(schema, modules);
    const liveId = await insertSession(t, {
      status: 'stopped',
      createdAt: 12_345,
    });

    const resumed = await t.mutation(
      internal.sandbox.session_mutations.resumeStoppedSession,
      { organizationId: ORG, sessionId: SID },
    );
    expect(resumed).toBe(true);
    const live = (await allSessions(t)).find((r) => r._id === liveId);
    expect(live?.status).toBe('active');
    // Same incarnation: createdAt is the --resume lower bound, must not move.
    expect(live?.createdAt).toBe(12_345);
    expect(live?.lastActivityAt).toBeGreaterThan(0);
    // Non-pinned: TTL window refreshed to ~now + 24h.
    expect(live?.expiresAt).toBeGreaterThan(Date.now());
    expect(live?.expiresAt).toBeLessThan(Date.now() + 2 * 86_400_000);
  });

  it('keeps a pinned row far-future expiresAt on resume', async () => {
    const t = convexTest(schema, modules);
    const farFuture = Date.now() + 5 * 365 * 86_400_000;
    const liveId = await t.run((ctx) =>
      ctx.db.insert('sandboxSessions', {
        organizationId: ORG,
        sessionId: SID,
        profile: 'agent',
        status: 'stopped',
        ownerType: 'user',
        ownerId: 'user_1',
        createdBy: 'user_1',
        createdAt: 0,
        expiresAt: farFuture,
        pinned: true,
      }),
    );
    await t.mutation(internal.sandbox.session_mutations.resumeStoppedSession, {
      organizationId: ORG,
      sessionId: SID,
    });
    const live = (await allSessions(t)).find((r) => r._id === liveId);
    expect(live?.status).toBe('active');
    expect(live?.expiresAt).toBe(farFuture);
  });
});

describe('getActiveSessionByOwner', () => {
  it('returns a stopped row so the next turn RESUMES it (not a fresh sandbox)', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, { status: 'destroyed', createdAt: 0 });
    await insertSession(t, { status: 'stopped', createdAt: 20 });

    const row = await t.query(
      internal.sandbox.session_queries.getActiveSessionByOwner,
      { ownerType: 'user', ownerId: 'user_1' },
    );
    expect(row?.status).toBe('stopped');
    expect(row?.createdAt).toBe(20);
  });
});

describe('recoverStuckSessions', () => {
  it('exempts stopped rows from TTL expiry, but expires a stuck active row', async () => {
    const t = convexTest(schema, modules);
    // Both rows are past expiresAt (createdAt 0 → expiresAt 86400000, in 1970).
    await insertSession(t, { status: 'stopped', createdAt: 0 });
    const activeOrg = 'org_stuck';
    const activeId = await insertSession(t, {
      status: 'active',
      organizationId: activeOrg,
      createdAt: 0,
    });

    await t.mutation(
      internal.sandbox.session_mutations.recoverStuckSessions,
      {},
    );

    const rows = await allSessions(t);
    // Stopped is hibernated indefinitely — persists until an explicit Destroy.
    expect(rows.find((r) => r.status === 'stopped')).toBeDefined();
    // The stuck active row is expired (leaked-row TTL backstop still works).
    expect(rows.find((r) => r._id === activeId)?.status).toBe('expired');
  });

  it('never expires a stuck row that still has a RUNNING agent-run op', async () => {
    const t = convexTest(schema, modules);
    const liveId = await insertSession(t, { status: 'active', createdAt: 0 });
    await t.run((ctx) =>
      ctx.db.insert('sandboxSessionOps', {
        organizationId: ORG,
        sessionId: SID,
        execId: 'exec_live',
        kind: 'agent-run',
        status: 'running',
        startedAt: 0,
      }),
    );

    await t.mutation(
      internal.sandbox.session_mutations.recoverStuckSessions,
      {},
    );

    // An unbounded turn legitimately outlives the 24h TTL — the row must survive
    // so the cron-driven reaper can't orphan the live exec.
    expect((await allSessions(t)).find((r) => r._id === liveId)?.status).toBe(
      'active',
    );
  });

  it('expires a stuck row whose agent-run op already finished', async () => {
    const t = convexTest(schema, modules);
    const liveId = await insertSession(t, { status: 'active', createdAt: 0 });
    await t.run((ctx) =>
      ctx.db.insert('sandboxSessionOps', {
        organizationId: ORG,
        sessionId: SID,
        execId: 'exec_done',
        kind: 'agent-run',
        status: 'completed',
        startedAt: 0,
      }),
    );

    await t.mutation(
      internal.sandbox.session_mutations.recoverStuckSessions,
      {},
    );

    expect((await allSessions(t)).find((r) => r._id === liveId)?.status).toBe(
      'expired',
    );
  });

  it('schedules VK teardown for the sessions it expires', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, { status: 'active', createdAt: 0 });

    await t.mutation(
      internal.sandbox.session_mutations.recoverStuckSessions,
      {},
    );

    // The row flip alone would leave a live gateway VK — expiry must schedule
    // the out-of-band revoke for the expired session id.
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const teardown = scheduled.find((s) =>
      s.name.includes('teardownExpiredSessions'),
    );
    expect(teardown).toBeDefined();
    expect(teardown?.args?.[0]?.sessionIds).toContain(SID);
  });
});

describe('listSessionsToReconcile', () => {
  it('returns active+degraded across orgs (incl. pinned), skips creating/stopped', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, {
      status: 'active',
      sessionId: 'a-active',
      ownerId: 'u1',
    });
    await insertSession(t, {
      status: 'degraded',
      sessionId: 'b-degraded',
      organizationId: OTHER_ORG,
      ownerId: 'u2',
    });
    await insertSession(t, {
      status: 'active',
      sessionId: 'c-pinned',
      pinned: true,
      ownerId: 'u3',
    });
    // Excluded: creating (mid-spin-up) and stopped (already reconciled).
    await insertSession(t, {
      status: 'creating',
      sessionId: 'd-creating',
      ownerId: 'u4',
    });
    await insertSession(t, {
      status: 'stopped',
      sessionId: 'e-stopped',
      ownerId: 'u5',
    });

    const rows = await t.query(
      internal.sandbox.session_queries.listSessionsToReconcile,
      { limit: 100 },
    );
    const ids = rows.map((r) => r.sessionId).sort();
    expect(ids).toEqual(['a-active', 'b-degraded', 'c-pinned']);
    // Pinned flag + profile ride along so the cron decides re-push vs recreate.
    expect(rows.find((r) => r.sessionId === 'c-pinned')?.pinned).toBe(true);
    expect(rows.find((r) => r.sessionId === 'a-active')?.pinned).toBe(false);
    expect(rows.every((r) => r.profile === 'agent')).toBe(true);
    // Cross-org: the other org's row is included (the cron is deployment-wide).
    expect(rows.find((r) => r.sessionId === 'b-degraded')?.organizationId).toBe(
      OTHER_ORG,
    );
  });

  it('honours the limit', async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i += 1) {
      await insertSession(t, {
        status: 'active',
        sessionId: `s-${i}`,
        ownerId: `u-${i}`,
      });
    }
    const rows = await t.query(
      internal.sandbox.session_queries.listSessionsToReconcile,
      { limit: 3 },
    );
    expect(rows).toHaveLength(3);
  });
});

describe('revokeTokensForSession', () => {
  async function insertToken(
    t: T,
    overrides: { llmGatewayKeyId?: string; revokedAt?: number },
  ) {
    return t.run((ctx) =>
      ctx.db.insert('sandboxSessionTokens', {
        organizationId: ORG,
        sessionId: SID,
        tokenHash: `hash_${overrides.llmGatewayKeyId ?? 'none'}`,
        ...(overrides.llmGatewayKeyId !== undefined && {
          llmGatewayKeyId: overrides.llmGatewayKeyId,
        }),
        scope: {
          agentKind: 'claude-code',
          allowedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
          integrationGrants: [],
          budgetCents: 100,
        },
        createdAt: 0,
        expiresAt: Date.now() + 86_400_000,
        ...(overrides.revokedAt !== undefined && {
          revokedAt: overrides.revokedAt,
        }),
      }),
    );
  }

  it('marks unrevoked tokens revoked and returns their llmGatewayKeyIds (the gateway DELETE list)', async () => {
    const t = convexTest(schema, modules);
    await insertToken(t, { llmGatewayKeyId: 'vk_1' });
    await insertToken(t, { llmGatewayKeyId: 'vk_2' });

    const res = await t.mutation(
      internal.sandbox.session_mutations.revokeTokensForSession,
      { sessionId: SID },
    );
    expect(res.revoked).toBe(2);
    expect([...res.llmGatewayKeyIds].sort()).toEqual(['vk_1', 'vk_2']);
    const tokens = await t.run((ctx) =>
      ctx.db.query('sandboxSessionTokens').collect(),
    );
    expect(tokens.every((r) => r.revokedAt !== undefined)).toBe(true);
  });

  it('skips already-revoked tokens and omits keyless tokens from the DELETE list', async () => {
    const t = convexTest(schema, modules);
    await insertToken(t, { llmGatewayKeyId: 'vk_live' });
    await insertToken(t, { llmGatewayKeyId: 'vk_already', revokedAt: 5 });
    await insertToken(t, {}); // a token row with no llmGatewayKeyId

    const res = await t.mutation(
      internal.sandbox.session_mutations.revokeTokensForSession,
      { sessionId: SID },
    );
    // The keyless live token is still marked revoked (count 2), but only the one
    // carrying a llmGatewayKeyId is returned for the gateway DELETE; the
    // already-revoked one is untouched.
    expect(res.revoked).toBe(2);
    expect(res.llmGatewayKeyIds).toEqual(['vk_live']);
  });
});

describe('listWorkflowRunSessionsForExecution (user-Stop teardown enumeration)', () => {
  async function insertWfRunSession(
    t: T,
    opts: {
      sessionId: string;
      ownerId: string;
      status: SessionStatus;
      organizationId?: string;
    },
  ) {
    return t.run((ctx) =>
      ctx.db.insert('sandboxSessions', {
        organizationId: opts.organizationId ?? ORG,
        sessionId: opts.sessionId,
        profile: 'agent',
        status: opts.status,
        ownerType: 'workflow_run',
        ownerId: opts.ownerId,
        createdBy: 'system',
        createdAt: 0,
        expiresAt: 86_400_000,
        ...(opts.status === 'destroyed' ? { destroyedAt: 1 } : {}),
      }),
    );
  }

  it('returns only this execution’s LIVE sessions — spanning steps, excluding terminal, other execs, prefix-collisions, and other orgs', async () => {
    const t = convexTest(schema, modules);
    // Two live steps of execA (owner `${executionId}:${stepSlug}`).
    await insertWfRunSession(t, {
      sessionId: 'sA-work',
      ownerId: 'execA:work',
      status: 'active',
    });
    await insertWfRunSession(t, {
      sessionId: 'sA-review',
      ownerId: 'execA:review',
      status: 'stopped', // hibernated is still LIVE (workspace preserved)
    });
    // Terminal step of execA → excluded.
    await insertWfRunSession(t, {
      sessionId: 'sA-old',
      ownerId: 'execA:old',
      status: 'destroyed',
    });
    // A different execution → excluded.
    await insertWfRunSession(t, {
      sessionId: 'sB-work',
      ownerId: 'execB:work',
      status: 'active',
    });
    // Prefix collision: `execAB` must NOT fall in execA's `execA:`..`execA;` range.
    await insertWfRunSession(t, {
      sessionId: 'sAB-work',
      ownerId: 'execAB:work',
      status: 'active',
    });
    // Same prefix, different org → excluded by the defensive org filter.
    await insertWfRunSession(t, {
      sessionId: 'sA-otherorg',
      ownerId: 'execA:work2',
      status: 'active',
      organizationId: OTHER_ORG,
    });

    const live = await t.query(
      internal.sandbox.session_queries.listWorkflowRunSessionsForExecution,
      { organizationId: ORG, executionId: 'execA' },
    );
    expect(live.map((s) => s.sessionId).sort()).toEqual([
      'sA-review',
      'sA-work',
    ]);
  });
});

describe('destroyThreadOwnedSessions (end-of-turn run_code teardown)', () => {
  const THREAD = 'thr_thread_1';

  it('destroys the live thread-owned row and leaves other owners/threads alone', async () => {
    const t = convexTest(schema, modules);
    const liveId = await insertSession(t, {
      status: 'active',
      sessionId: 'thr-thread_1',
      ownerType: 'thread',
      ownerId: THREAD,
      createdAt: 20,
    });
    // Terminal incarnation of the same thread — must stay untouched.
    await insertSession(t, {
      status: 'destroyed',
      sessionId: 'thr-thread_1',
      ownerType: 'thread',
      ownerId: THREAD,
      createdAt: 0,
    });
    // Another thread's live session and the per-user agent sandbox — neither
    // may be reaped by this thread's turn end.
    const otherThreadId = await insertSession(t, {
      status: 'active',
      sessionId: 'thr-thread_2',
      ownerType: 'thread',
      ownerId: 'thr_thread_2',
      createdAt: 20,
    });
    const userSessionId = await insertSession(t, {
      status: 'active',
      createdAt: 20,
    });

    await t.mutation(
      internal.sandbox.session_mutations.destroyThreadOwnedSessions,
      { threadId: THREAD },
    );

    const rows = await allSessions(t);
    const live = rows.find((r) => r._id === liveId);
    expect(live?.status).toBe('destroyed');
    expect(live?.destroyedAt).toBeGreaterThan(0);
    expect(rows.find((r) => r._id === otherThreadId)?.status).toBe('active');
    expect(rows.find((r) => r._id === userSessionId)?.status).toBe('active');
    // The historical terminal row keeps its original destroyedAt (fixture: 1).
    expect(
      rows.find((r) => r.ownerId === THREAD && r.createdAt === 0)?.destroyedAt,
    ).toBe(1);
  });

  it('no-ops when the turn ran no run_code (no live thread rows)', async () => {
    const t = convexTest(schema, modules);
    await insertSession(t, {
      status: 'destroyed',
      sessionId: 'thr-thread_1',
      ownerType: 'thread',
      ownerId: THREAD,
      createdAt: 0,
    });

    await t.mutation(
      internal.sandbox.session_mutations.destroyThreadOwnedSessions,
      { threadId: THREAD },
    );

    const rows = await allSessions(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.destroyedAt).toBe(1);
  });
});
