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
  },
) {
  const createdAt = overrides.createdAt ?? 0;
  return t.run((ctx) =>
    ctx.db.insert('sandboxSessions', {
      organizationId: overrides.organizationId ?? ORG,
      sessionId: SID,
      profile: 'agent',
      status: overrides.status,
      ownerType: 'user',
      ownerId: 'user_1',
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
      sessionId: SID,
      pinned: false,
    });

    const rows = await allSessions(t);
    const live = rows.find((r) => r._id === liveId);
    expect(live?.pinned).toBe(false);
    expect(live?.pinnedAt).toBeUndefined();
    expect(live?.expiresAt).toBeLessThan(Date.now() + 2 * 86_400_000);
  });
});
