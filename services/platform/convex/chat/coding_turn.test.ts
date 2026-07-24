// Data-layer guarantees the coding-turn finalize depends on. These lock the
// two invariants that close the per-turn VK leak (plan Contract 3) and the
// double-charge race (plan Phase 1): a turn's gateway key is recorded so it is
// always revocable, and exactly ONE finalizer wins so usage is metered + the VK
// revoked once. The node orchestration (finalizeCodingTurn) is thin glue over
// these; the hazards live here.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
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
