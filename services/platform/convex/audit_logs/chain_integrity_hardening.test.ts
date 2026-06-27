import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { createAuditLog } from './helpers';
import * as verifyIntegrityModule from './verify_integrity';
import { verifyAuditChain } from './verify_integrity';

// convex-test module map keyed relative to the convex/ root. This file lives
// at convex/audit_logs/, so resolve glob keys against that base (mirrors
// integrity_check.test.ts).
const TEST_DIR_FROM_CONVEX_ROOT = 'audit_logs';
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

function args(organizationId: string, action: string) {
  return {
    organizationId,
    actorId: 'tester',
    actorType: 'system' as const,
    action,
    category: 'data' as const,
    resourceType: 'customer',
    status: 'success' as const,
  };
}

async function seed(t: T, organizationId: string, action: string) {
  await t.mutation(internal.audit_logs.internal_mutations.createAuditLog, {
    ...args(organizationId, action),
  });
}

async function rowsAsc(t: T, organizationId: string) {
  return t.run(async (ctx) => {
    const out = [];
    for await (const r of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', organizationId),
      )
      .order('asc')) {
      out.push(r);
    }
    return out;
  });
}

async function progressFor(t: T, organizationId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('auditIntegrityProgress')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      )
      .first(),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

// #1846 item 5 — within a single mutation there is no cross-row OCC, so two
// createAuditLog calls under Promise.all both read the same head and commit
// the same previousHash unless appends are serialized per ctx.
describe('intra-mutation chain fork (#1846 item 5)', () => {
  it('serializes parallel same-org appends so the chain does not fork', async () => {
    const t = convexTest(schema, modules);
    const ORG = 'org_intra_fork';

    await t.run(async (ctx) => {
      await Promise.all([
        createAuditLog(ctx, args(ORG, 'parallel.a')),
        createAuditLog(ctx, args(ORG, 'parallel.b')),
        createAuditLog(ctx, args(ORG, 'parallel.c')),
      ]);
    });

    const rows = await rowsAsc(t, ORG);
    expect(rows).toHaveLength(3);
    // Exactly one genesis row (empty previousHash); the rest chain forward.
    const genesisRows = rows.filter((r) => !r.previousHash);
    expect(genesisRows).toHaveLength(1);
    // No two rows share a previousHash — a fork would repeat one.
    const prevHashes = rows.map((r) => r.previousHash ?? '');
    expect(new Set(prevHashes).size).toBe(prevHashes.length);

    const result = await t.run((ctx) =>
      verifyAuditChain(ctx, { organizationId: ORG }),
    );
    expect(result.valid).toBe(true);
    expect(result.verifiedCount).toBe(3);
  });
});

// #1846 item 4 — the chain is ordered by the app-level timestamp; a backward
// clock step would otherwise sort a new row before the head it chains off,
// permanently orphaning it and tripping a false tamper alarm.
describe('timestamp monotonicity clamp (#1846 item 4)', () => {
  it('clamps the timestamp forward when the wall clock steps backward', async () => {
    const t = convexTest(schema, modules);
    const ORG = 'org_clock_skew';
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(5_000);
    await t.run((ctx) => createAuditLog(ctx, args(ORG, 'before.skew')));
    // Clock steps backward (NTP correction / VM snapshot restore).
    nowSpy.mockReturnValue(1_000);
    await t.run((ctx) => createAuditLog(ctx, args(ORG, 'after.skew')));

    const rows = await rowsAsc(t, ORG);
    expect(rows.map((r) => r.action)).toEqual(['before.skew', 'after.skew']);
    expect(rows[0].timestamp).toBe(5_000);
    // Clamped to lastInsertedAt + 1 rather than the regressed 1_000.
    expect(rows[1].timestamp).toBe(5_001);

    const result = await t.run((ctx) =>
      verifyAuditChain(ctx, { organizationId: ORG }),
    );
    expect(result.valid).toBe(true);
    expect(result.verifiedCount).toBe(2);
  });
});

// #1846 item 3 — the documented fromTimestamp resume path used to report a
// false break at the first row of any resumed page. A correct resume seeds the
// linkage from the previous page's last hash and skips up to/including afterId.
describe('paged resume (#1846 item 3)', () => {
  it('pages a chain across runs with an exact (timestamp, _id, hash) cursor', async () => {
    const t = convexTest(schema, modules);
    const ORG = 'org_resume';
    for (let i = 0; i < 5; i++) await seed(t, ORG, `row.${i}`);

    const pages = await t.run(async (ctx) => {
      const p1 = await verifyAuditChain(ctx, {
        organizationId: ORG,
        maxEntries: 2,
      });
      const p2 = await verifyAuditChain(ctx, {
        organizationId: ORG,
        maxEntries: 2,
        fromTimestamp: p1.lastVerifiedTimestamp,
        afterId: p1.lastVerifiedId,
        previousExpectedHash: p1.lastVerifiedHash,
      });
      const p3 = await verifyAuditChain(ctx, {
        organizationId: ORG,
        maxEntries: 2,
        fromTimestamp: p2.lastVerifiedTimestamp,
        afterId: p2.lastVerifiedId,
        previousExpectedHash: p2.lastVerifiedHash,
      });
      return { p1, p2, p3 };
    });

    expect(pages.p1).toMatchObject({
      valid: true,
      truncated: true,
      verifiedCount: 2,
    });
    expect(pages.p2).toMatchObject({
      valid: true,
      truncated: true,
      verifiedCount: 2,
    });
    expect(pages.p3).toMatchObject({
      valid: true,
      truncated: false,
      verifiedCount: 1,
    });
    expect(
      pages.p1.verifiedCount + pages.p2.verifiedCount + pages.p3.verifiedCount,
    ).toBe(5);
  });

  it('does not report a false break on a fromTimestamp-only resume', async () => {
    const t = convexTest(schema, modules);
    const ORG = 'org_resume_legacy';
    for (let i = 0; i < 4; i++) await seed(t, ORG, `row.${i}`);

    const { p1, naive } = await t.run(async (ctx) => {
      const first = await verifyAuditChain(ctx, {
        organizationId: ORG,
        maxEntries: 2,
      });
      // Pre-fix this seeded previousExpectedHash from '' and forced a break at
      // the first resumed row; now the boundary row is trusted instead.
      const second = await verifyAuditChain(ctx, {
        organizationId: ORG,
        fromTimestamp: first.lastVerifiedTimestamp,
      });
      return { p1: first, naive: second };
    });

    expect(p1.valid).toBe(true);
    expect(naive.valid).toBe(true);
    expect(naive.firstBrokenAt).toBeUndefined();
  });
});

// PR #2218 review BLOCKING 1 — when retention hard-deletes the persisted
// cursor row AND one or more rows after it, the resume must NOT compare the
// first surviving row against the stale supplied previousExpectedHash (the
// deleted cursor's hash), which produced a false `firstBrokenAt` / critical
// tamper alert that re-fired every run.
describe('deleted-cursor resume (#1846 item 3 / PR #2218 BLOCKING 1)', () => {
  it('does not report a false break when retention deletes the cursor row and rows after it', async () => {
    const t = convexTest(schema, modules);
    const ORG = 'org_deleted_cursor';
    for (let i = 0; i < 6; i++) await seed(t, ORG, `row.${i}`);

    // Page 1 verifies the oldest 2 rows and yields a full cursor.
    const p1 = await t.run((ctx) =>
      verifyAuditChain(ctx, { organizationId: ORG, maxEntries: 2 }),
    );
    expect(p1).toMatchObject({ valid: true, verifiedCount: 2 });

    // Retention hard-deletes indices 0–3 — the cursor row (index 1) AND rows
    // after it — leaving only indices 4–5.
    const before = await rowsAsc(t, ORG);
    await t.run(async (ctx) => {
      for (const r of before.slice(0, 4)) {
        await ctx.db.delete(r._id as Id<'auditLogs'>);
      }
    });
    const remaining = await rowsAsc(t, ORG);
    expect(remaining).toHaveLength(2);

    // Resume with the FULL cron cursor (afterId now points at a deleted row).
    const p2 = await t.run((ctx) =>
      verifyAuditChain(ctx, {
        organizationId: ORG,
        maxEntries: 2,
        fromTimestamp: p1.lastVerifiedTimestamp,
        afterId: p1.lastVerifiedId,
        previousExpectedHash: p1.lastVerifiedHash,
      }),
    );

    expect(p2.firstBrokenAt).toBeUndefined();
    expect(p2.valid).toBe(true);
    expect(p2.verifiedCount).toBe(2);
  });

  it('still verifies when retention deletes exactly up to the cursor row', async () => {
    const t = convexTest(schema, modules);
    const ORG = 'org_deleted_cursor_boundary';
    for (let i = 0; i < 6; i++) await seed(t, ORG, `row.${i}`);

    const p1 = await t.run((ctx) =>
      verifyAuditChain(ctx, { organizationId: ORG, maxEntries: 2 }),
    );

    // Delete exactly indices 0–1 (up to and including the cursor row).
    const before = await rowsAsc(t, ORG);
    await t.run(async (ctx) => {
      for (const r of before.slice(0, 2)) {
        await ctx.db.delete(r._id as Id<'auditLogs'>);
      }
    });

    const p2 = await t.run((ctx) =>
      verifyAuditChain(ctx, {
        organizationId: ORG,
        maxEntries: 10,
        fromTimestamp: p1.lastVerifiedTimestamp,
        afterId: p1.lastVerifiedId,
        previousExpectedHash: p1.lastVerifiedHash,
      }),
    );

    expect(p2.valid).toBe(true);
    expect(p2.firstBrokenAt).toBeUndefined();
    expect(p2.verifiedCount).toBe(4);
  });
});

// PR #2218 review BLOCKING 2 — an org whose verification throws must still
// rotate to the back of the round-robin queue (its progress `updatedAt` is
// bumped) so it can't sort to the front of every run and starve healthy orgs
// past the per-run cap.
describe('erroring-org rotation (#1846 item 1 / PR #2218 BLOCKING 2)', () => {
  it('rotates a throwing org to the back instead of starving the queue', async () => {
    const t = convexTest(schema, modules);
    const ORG = 'org_throwing';
    await seed(t, ORG, 'row.0');

    // Force the per-org verification to throw for this run.
    vi.spyOn(verifyIntegrityModule, 'verifyAuditChain').mockRejectedValue(
      new Error('boom'),
    );

    await t.action(
      internal.audit_logs.integrity_check.runAuditIntegrityCheck,
      {},
    );

    // The erroring org now carries a progress row with a bumped `updatedAt`
    // (rotated to the back) but no advanced cursor.
    const progress = await progressFor(t, ORG);
    expect(progress).not.toBeNull();
    expect(progress?.updatedAt).toBeGreaterThan(0);
    expect(progress?.headReached).toBe(false);
    expect(progress?.lastVerifiedId).toBeUndefined();

    vi.restoreAllMocks();

    // A never-checked org (sentinel -1) must now sort AHEAD of the touched
    // throwing org — proving the throwing org rotated to the back rather than
    // pinning the front of the queue forever.
    await seed(t, 'org_fresh', 'row.0');
    const selection = await t.query(
      internal.audit_logs.integrity_check.selectOrgsForIntegrityRun,
      {},
    );
    expect(selection.organizationIds[0]).toBe('org_fresh');
  });
});

// #1846 items 1 + 2 — the cron must page forward across runs (persisting a
// per-org cursor) and select orgs round-robin so coverage is not capped at the
// oldest window or the first MAX_ORGS_PER_RUN orgs.
describe('cron coverage + progress (#1846 items 1 + 2)', () => {
  it('persists a forward cursor and advances it as new rows are appended', async () => {
    const t = convexTest(schema, modules);
    const ORG = 'org_progress';
    await seed(t, ORG, 'first');
    await seed(t, ORG, 'second');

    await t.action(
      internal.audit_logs.integrity_check.runAuditIntegrityCheck,
      {},
    );

    const after1 = await progressFor(t, ORG);
    expect(after1).not.toBeNull();
    expect(after1?.headReached).toBe(true);
    expect(after1?.lastVerifiedId).toBeTruthy();
    const cursor1 = after1?.lastVerifiedTimestamp ?? 0;

    // New rows appended after the cursor must be picked up on the next run.
    await seed(t, ORG, 'third');
    await t.action(
      internal.audit_logs.integrity_check.runAuditIntegrityCheck,
      {},
    );

    const after2 = await progressFor(t, ORG);
    expect(after2?.lastVerifiedTimestamp ?? 0).toBeGreaterThan(cursor1);
    expect(after2?.headReached).toBe(true);
  });

  it('selects every audited org when under the per-run cap', async () => {
    const t = convexTest(schema, modules);
    await seed(t, 'org_select_a', 'a');
    await seed(t, 'org_select_b', 'b');

    const selection = await t.query(
      internal.audit_logs.integrity_check.selectOrgsForIntegrityRun,
      {},
    );
    expect(selection.totalOrgs).toBe(2);
    expect(selection.truncated).toBe(false);
    expect([...selection.organizationIds].sort()).toEqual([
      'org_select_a',
      'org_select_b',
    ]);
  });
});
