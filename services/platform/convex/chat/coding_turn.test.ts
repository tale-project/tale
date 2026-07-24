// Data-layer guarantees the coding-turn finalize depends on. These lock the
// two invariants that close the per-turn VK leak (plan Contract 3) and the
// double-charge race (plan Phase 1): a turn's gateway key is recorded so it is
// always revocable, and exactly ONE finalizer wins so usage is metered + the VK
// revoked once. The node orchestration (finalizeCodingTurn) is thin glue over
// these; the hazards live here.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'chat';
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

const ORG = 'org_coding';
const SID = 'usr-user_1-deadbeefdeadbeef';
const EXEC = 'exec-1';

/** Open a running agent-run op row exactly as the coding kick does. */
async function openOp(
  t: T,
  overrides: { execId?: string; mintedKeyId?: string } = {},
) {
  return t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
    organizationId: ORG,
    sessionId: SID,
    threadId: 'thread_1',
    execId: overrides.execId ?? EXEC,
    kind: 'agent-run',
    status: 'running',
    assistantMessageId: 'msg_1',
    userId: 'user_1',
    heartbeatAt: 100,
    ...(overrides.mintedKeyId !== undefined
      ? { mintedKeyId: overrides.mintedKeyId }
      : {}),
  });
}

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
  role = 'member',
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    });
  });
}

describe('recordTurnEvent + getCodingTurnMetrics — the turn SLO', () => {
  const ADMIN = 'user_admin';

  async function record(
    t: T,
    ev: {
      harness: string;
      outcome: 'completed' | 'failed' | 'cancelled' | 'timeout';
      durationMs: number;
      spentCents?: number;
      recovered?: boolean;
    },
  ) {
    await t.mutation(internal.sandbox.session_mutations.recordTurnEvent, {
      organizationId: ORG,
      threadId: 'thread_1',
      userId: 'user_1',
      harness: ev.harness,
      modelRef: 'anthropic/claude',
      outcome: ev.outcome,
      durationMs: ev.durationMs,
      ...(ev.spentCents !== undefined ? { spentCents: ev.spentCents } : {}),
      ...(ev.recovered !== undefined ? { recovered: ev.recovered } : {}),
    });
  }

  it('computes success rate excluding cancels, per-harness, p50/p95, spend', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG, 'admin');
    // 3 completed, 1 failed, 1 timeout, 1 cancelled across two harnesses.
    await record(t, {
      harness: 'claude-code',
      outcome: 'completed',
      durationMs: 1000,
      spentCents: 10,
    });
    await record(t, {
      harness: 'claude-code',
      outcome: 'completed',
      durationMs: 2000,
      spentCents: 20,
    });
    await record(t, {
      harness: 'claude-code',
      outcome: 'failed',
      durationMs: 3000,
    });
    await record(t, {
      harness: 'codex',
      outcome: 'completed',
      durationMs: 4000,
      spentCents: 5,
    });
    await record(t, { harness: 'codex', outcome: 'timeout', durationMs: 5000 });
    await record(t, {
      harness: 'codex',
      outcome: 'cancelled',
      durationMs: 6000,
    });

    const m = await t
      .withIdentity({ subject: ADMIN })
      .query(api.sandbox.session_queries_public.getCodingTurnMetrics, {
        organizationId: ORG,
      });
    expect(m).not.toBeNull();
    if (m === null) throw new Error('unreachable');
    expect(m.total).toBe(6);
    expect(m.completed).toBe(3);
    expect(m.failed).toBe(1);
    expect(m.timeout).toBe(1);
    expect(m.cancelled).toBe(1);
    // Success rate excludes the user cancel: 3 completed / (3+1+1) rated = 0.6.
    expect(m.successRate).toBeCloseTo(3 / 5, 5);
    expect(m.timeoutRate).toBeCloseTo(1 / 5, 5);
    expect(m.spentCents).toBe(35);
    // p50/p95 over [1000,2000,3000,4000,5000,6000].
    expect(m.durationP95Ms).toBe(6000);
    const cc = m.byHarness.find((h) => h.harness === 'claude-code');
    expect(cc?.total).toBe(3);
    expect(cc?.completed).toBe(2);
    expect(cc?.successRate).toBeCloseTo(2 / 3, 5);
  });

  it('counts recovered turns and denies non-developers', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG, 'admin');
    await record(t, {
      harness: 'claude-code',
      outcome: 'failed',
      durationMs: 100,
      recovered: true,
    });

    const m = await t
      .withIdentity({ subject: ADMIN })
      .query(api.sandbox.session_queries_public.getCodingTurnMetrics, {
        organizationId: ORG,
      });
    expect(m?.recovered).toBe(1);

    // A plain member lacks developerSettings → the query returns null.
    const MEMBER = 'user_member';
    await seedMember(t, MEMBER, ORG, 'member');
    const denied = await t
      .withIdentity({ subject: MEMBER })
      .query(api.sandbox.session_queries_public.getCodingTurnMetrics, {
        organizationId: ORG,
      });
    expect(denied).toBeNull();
  });
});

describe('getCodingOpForFinalize', () => {
  it('returns the op row mintedKeyId — the VK the finalize revokes', async () => {
    const t = convexTest(schema, modules);
    await openOp(t, { mintedKeyId: 'vk_abc' });

    const op = await t.query(
      internal.sandbox.session_queries.getCodingOpForFinalize,
      { sessionId: SID, execId: EXEC },
    );
    expect(op).not.toBeNull();
    expect(op?.mintedKeyId).toBe('vk_abc');
    expect(op?.finalizedAt).toBeUndefined();
  });

  it('returns null when the op row is gone (already reaped)', async () => {
    const t = convexTest(schema, modules);
    const op = await t.query(
      internal.sandbox.session_queries.getCodingOpForFinalize,
      { sessionId: SID, execId: 'never' },
    );
    expect(op).toBeNull();
  });
});

describe('claimSessionOpFinalize — exactly-once (no double charge)', () => {
  it('elects a single winner across racing finalizers', async () => {
    const t = convexTest(schema, modules);
    await openOp(t);

    const first = await t.mutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      { sessionId: SID, execId: EXEC },
    );
    const second = await t.mutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      { sessionId: SID, execId: EXEC },
    );
    expect(first).toBe(true);
    expect(second).toBe(false);

    // The claim is visible to a subsequent finalize read (loser path bails on it).
    const op = await t.query(
      internal.sandbox.session_queries.getCodingOpForFinalize,
      { sessionId: SID, execId: EXEC },
    );
    expect(op?.finalizedAt).toBeGreaterThan(0);
  });

  it('never claims a missing op row', async () => {
    const t = convexTest(schema, modules);
    const won = await t.mutation(
      internal.sandbox.session_mutations.claimSessionOpFinalize,
      { sessionId: SID, execId: 'missing' },
    );
    expect(won).toBe(false);
  });
});

describe('markSessionTokenRevokedByKeyId — the leak close', () => {
  async function insertToken(t: T, keyId: string) {
    return t.run((ctx) =>
      ctx.db.insert('sandboxSessionTokens', {
        organizationId: ORG,
        sessionId: SID,
        tokenHash: `hash-${keyId}`,
        llmGatewayKeyId: keyId,
        scope: {
          agentKind: 'claude-code',
          allowedModels: ['anthropic/claude'],
          integrationGrants: [],
          budgetCents: 500,
        },
        createdAt: 0,
        expiresAt: 10_000,
      }),
    );
  }

  it('marks only the turn key revoked, leaving other session keys live', async () => {
    const t = convexTest(schema, modules);
    await insertToken(t, 'vk_turn');
    await insertToken(t, 'vk_other');

    await t.mutation(
      internal.sandbox.session_mutations.markSessionTokenRevokedByKeyId,
      { sessionId: SID, llmGatewayKeyId: 'vk_turn' },
    );

    const rows = await t.run((ctx) =>
      ctx.db
        .query('sandboxSessionTokens')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', SID))
        .collect(),
    );
    const turn = rows.find((r) => r.llmGatewayKeyId === 'vk_turn');
    const other = rows.find((r) => r.llmGatewayKeyId === 'vk_other');
    expect(turn?.revokedAt).toBeGreaterThan(0);
    expect(other?.revokedAt).toBeUndefined();
  });

  it('is idempotent — a second mark keeps the original revokedAt', async () => {
    const t = convexTest(schema, modules);
    await insertToken(t, 'vk_turn');

    await t.mutation(
      internal.sandbox.session_mutations.markSessionTokenRevokedByKeyId,
      { sessionId: SID, llmGatewayKeyId: 'vk_turn' },
    );
    const first = await t.run(async (ctx) => {
      const r = await ctx.db
        .query('sandboxSessionTokens')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', SID))
        .first();
      return r?.revokedAt;
    });
    await t.mutation(
      internal.sandbox.session_mutations.markSessionTokenRevokedByKeyId,
      { sessionId: SID, llmGatewayKeyId: 'vk_turn' },
    );
    const second = await t.run(async (ctx) => {
      const r = await ctx.db
        .query('sandboxSessionTokens')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', SID))
        .first();
      return r?.revokedAt;
    });
    expect(second).toBe(first);
  });
});

describe('hasLiveGenerationInternal — the at-most-one-turn gate', () => {
  async function insertThread(t: T) {
    return t.run((ctx) =>
      ctx.db.insert('threads', {
        organizationId: ORG,
        userId: 'user_1',
        kind: 'sandbox',
        title: 'T',
        archived: false,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
  }

  it('reports a thread busy while a generation row is live', async () => {
    const t = convexTest(schema, modules);
    const threadId = await insertThread(t);
    await t.run((ctx) =>
      ctx.db.insert('generations', {
        organizationId: ORG,
        threadId,
        status: 'streaming',
        streamId: 's1',
        startedAt: 0,
        heartbeatAt: Date.now(),
      }),
    );

    const busy = await t.query(
      internal.chat.generations.hasLiveGenerationInternal,
      { organizationId: ORG, threadId },
    );
    expect(busy).toBe(true);
  });

  it('reports idle with no generation, and never crosses orgs', async () => {
    const t = convexTest(schema, modules);
    const threadId = await insertThread(t);

    expect(
      await t.query(internal.chat.generations.hasLiveGenerationInternal, {
        organizationId: ORG,
        threadId,
      }),
    ).toBe(false);

    // A live row under a DIFFERENT org must not mark this thread busy.
    await t.run((ctx) =>
      ctx.db.insert('generations', {
        organizationId: 'org_other',
        threadId,
        status: 'streaming',
        streamId: 's1',
        startedAt: 0,
        heartbeatAt: Date.now(),
      }),
    );
    expect(
      await t.query(internal.chat.generations.hasLiveGenerationInternal, {
        organizationId: ORG,
        threadId,
      }),
    ).toBe(false);
  });
});

describe('recoverStaleDirectGenerations — unwedge a crashed direct turn', () => {
  async function insertGeneration(
    t: T,
    overrides: { heartbeatAt: number; coding?: boolean; threadId?: string },
  ) {
    return t.run((ctx) =>
      ctx.db.insert('generations', {
        organizationId: ORG,
        threadId: overrides.threadId ?? 'thread_direct',
        status: 'streaming',
        streamId: 'stream_1',
        startedAt: 0,
        heartbeatAt: overrides.heartbeatAt,
        ...(overrides.coding === true
          ? {
              coding: {
                execId: EXEC,
                lastSeq: 0,
                harness: 'claude-code',
                providerSlug: 'anthropic',
                gatewayModel: 'claude',
              },
            }
          : {}),
      }),
    );
  }

  it('clears a stale direct row but spares a fresh one and a coding row', async () => {
    const t = convexTest(schema, modules);
    const stale = 100; // far below any realistic now - stale window
    const fresh = Date.now();
    const staleDirect = await insertGeneration(t, {
      heartbeatAt: stale,
      threadId: 'thread_stale',
    });
    const freshDirect = await insertGeneration(t, {
      heartbeatAt: fresh,
      threadId: 'thread_fresh',
    });
    const staleCoding = await insertGeneration(t, {
      heartbeatAt: stale,
      coding: true,
      threadId: 'thread_coding',
    });

    const cleared = await t.mutation(
      internal.chat.generations.recoverStaleDirectGenerations,
      {},
    );
    expect(cleared).toBe(1);

    const rows = await t.run((ctx) => ctx.db.query('generations').collect());
    const ids = rows.map((r) => r._id);
    expect(ids).not.toContain(staleDirect);
    expect(ids).toContain(freshDirect); // fresh heartbeat → live turn, kept
    expect(ids).toContain(staleCoding); // coding lane → op-row recovery, kept
  });
});

describe('upsertSessionOp terminal state — harness crash is not a silent success', () => {
  it('stamps the agent status + exit code and marks the op terminal', async () => {
    const t = convexTest(schema, modules);
    await openOp(t);

    await t.mutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: ORG,
      sessionId: SID,
      threadId: 'thread_1',
      execId: EXEC,
      kind: 'agent-run',
      status: 'failed',
      exitCode: 137,
      agentResultStatus: 'error_max_turns',
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('sandboxSessionOps')
        .withIndex('by_sessionId_and_execId', (q) =>
          q.eq('sessionId', SID).eq('execId', EXEC),
        )
        .first(),
    );
    expect(row?.status).toBe('failed');
    expect(row?.exitCode).toBe(137);
    expect(row?.agentResultStatus).toBe('error_max_turns');
    expect(row?.finishedAt).toBeGreaterThan(0);
  });
});
