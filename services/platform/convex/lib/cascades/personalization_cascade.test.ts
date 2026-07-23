import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cascadeOnMemberRemoved,
  cascadeOnOrgDeleted,
  drainOrgPersonalizationErasureOnce,
} from './personalization_cascade';

interface FakeRow {
  _id: string;
  userId?: string;
  organizationId?: string;
  storageId?: string;
}

// The fake store is keyed by `${table}::${index}` — NOT by index name alone —
// so two tables exposing an identically-named index (e.g. `by_organizationId`)
// can never collide and silently share one row array.
function createCtx(rowsByKey: Record<string, FakeRow[]>) {
  const deleted: string[] = [];
  const storageDeleted: string[] = [];
  // Interleaved record of db.delete (`del:`) vs storage.delete (`store:`) so a
  // test can assert the row is deleted before its blob.
  const timeline: string[] = [];
  const scheduled: Array<{ fn: unknown; args: unknown }> = [];
  const lastIndexUsed: { table: string; name: string }[] = [];
  // Each `take()` empties the per-key store so a paged loop terminates;
  // `collect()` reads the original seed (the member-removed path uses collect).
  const remaining: Record<string, FakeRow[]> = {};
  for (const [k, val] of Object.entries(rowsByKey)) remaining[k] = [...val];

  const ctx = {
    db: {
      query: vi.fn((table: string) => ({
        withIndex: (indexName: string, cb: (q: unknown) => unknown) => {
          const builder: unknown = {
            eq: () => builder,
          };
          cb(builder);
          lastIndexUsed.push({ table, name: indexName });
          const key = `${table}::${indexName}`;
          return {
            collect: async (): Promise<FakeRow[]> => rowsByKey[key] ?? [],
            take: async (n: number): Promise<FakeRow[]> => {
              const rows = remaining[key] ?? [];
              return rows.splice(0, n);
            },
          };
        },
      })),
      delete: vi.fn(async (id: string) => {
        deleted.push(id);
        timeline.push(`del:${id}`);
      }),
    },
    storage: {
      delete: vi.fn(async (id: string) => {
        storageDeleted.push(id);
        timeline.push(`store:${id}`);
      }),
    },
    scheduler: {
      runAfter: vi.fn(async (_delay: number, fn: unknown, args: unknown) => {
        scheduled.push({ fn, args });
      }),
    },
  } as never;

  return { ctx, deleted, storageDeleted, timeline, scheduled, lastIndexUsed };
}

/** Run the drain to completion, returning the number of productive passes. */
async function drainToCompletion(
  ctx: never,
  organizationId: string,
): Promise<number> {
  let passes = 0;
  for (;;) {
    const { rescheduled } = await drainOrgPersonalizationErasureOnce(
      ctx,
      organizationId,
    );
    if (!rescheduled) break;
    passes += 1;
    if (passes > 10_000) throw new Error('drain did not terminate');
  }
  return passes;
}

describe('cascadeOnMemberRemoved', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes (user, org) preferences via the composite index', async () => {
    const { ctx, deleted, storageDeleted, lastIndexUsed } = createCtx({
      'userPreferences::by_userId_organizationId': [
        { _id: 'pref_1', userId: 'u_1', organizationId: 'o_1' },
        { _id: 'pref_2', userId: 'u_1', organizationId: 'o_1' },
      ],
    });

    await cascadeOnMemberRemoved(ctx, 'u_1', 'o_1');

    expect(deleted).toEqual(expect.arrayContaining(['pref_1', 'pref_2']));
    expect(deleted).toHaveLength(2);
    expect(storageDeleted).toHaveLength(0);
    expect(lastIndexUsed.map((u) => u.name)).toEqual([
      'by_userId_organizationId',
    ]);
  });

  it('is a no-op when the user has no rows', async () => {
    const { ctx, deleted, storageDeleted } = createCtx({});
    await cascadeOnMemberRemoved(ctx, 'u_1', 'o_1');
    expect(deleted).toHaveLength(0);
    expect(storageDeleted).toHaveLength(0);
  });
});

describe('cascadeOnOrgDeleted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('schedules the bounded drain instead of deleting inline', async () => {
    // The kickoff must add ZERO writes to the caller's mutation — it only
    // schedules the self-rescheduling drain (which runs with its own budget).
    const { ctx, deleted, storageDeleted, scheduled } = createCtx({
      'userPreferences::by_organizationId': [
        { _id: 'pref_a', organizationId: 'o_1' },
      ],
    });

    await cascadeOnOrgDeleted(ctx, 'o_1');

    expect(deleted).toHaveLength(0);
    expect(storageDeleted).toHaveLength(0);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual({ organizationId: 'o_1' });
  });
});

describe('drainOrgPersonalizationErasureOnce', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drains at most ONE table per pass, in priority order, and erases everything', async () => {
    const c = createCtx({
      'userPreferences::by_organizationId': [
        { _id: 'p1', organizationId: 'o_1' },
        { _id: 'p2', organizationId: 'o_1' },
      ],
      'videoLinkJobs::by_organizationId_and_status': [
        { _id: 'v1', organizationId: 'o_1', storageId: 'bv1' },
      ],
    });

    // Pass 1: prefs only.
    let r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toEqual(['p1', 'p2']);
    expect(c.storageDeleted).toEqual([]);

    // Pass 2: videoLink only (prefs now empty) — row deleted before its blob.
    r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toEqual(['p1', 'p2', 'v1']);
    expect(c.storageDeleted).toEqual(['bv1']);
    expect(c.timeline.indexOf('del:v1')).toBeLessThan(
      c.timeline.indexOf('store:bv1'),
    );

    // Pass 3: all empty → done, no further reschedule.
    r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(false);
    expect(c.scheduled).toHaveLength(2); // one per productive pass
  });

  it('caps a single pass at 6000 row-deletes for the pure-DB table and never spills into the next table', async () => {
    const manyPrefs: FakeRow[] = Array.from({ length: 6001 }, (_, i) => ({
      _id: `p_${i}`,
      organizationId: 'o_1',
    }));
    const c = createCtx({
      'userPreferences::by_organizationId': manyPrefs,
      'videoLinkJobs::by_organizationId_and_status': [
        { _id: 'v1', organizationId: 'o_1', storageId: 'bv1' },
      ],
    });

    // Pass 1 must delete exactly the 6000-row cap and stop — videoLink untouched.
    const r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toHaveLength(6000);
    expect(c.deleted).not.toContain('v1');

    // Drive the rest: the 6001st pref, then the videoLink job, then done.
    const morePasses = await drainToCompletion(c.ctx, 'o_1');
    expect(c.deleted).toHaveLength(6002); // 6001 prefs + 1 videoLink job
    expect(c.deleted).toContain('p_6000');
    expect(c.deleted).toContain('v1');
    // 1 cap pass already counted above; remainder is bounded and small.
    expect(morePasses).toBeGreaterThanOrEqual(2);
  });

  it('caps a storage-bearing pass at 3000 rows (lower than the pure-DB cap)', async () => {
    const manyJobs: FakeRow[] = Array.from({ length: 3001 }, (_, i) => ({
      _id: `v_${i}`,
      organizationId: 'o_1',
      storageId: `b_${i}`,
    }));
    const c = createCtx({
      'videoLinkJobs::by_organizationId_and_status': manyJobs,
    });

    const r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toHaveLength(3000);
    expect(c.storageDeleted).toHaveLength(3000);

    await drainToCompletion(c.ctx, 'o_1');
    expect(c.deleted).toHaveLength(3001);
    expect(c.storageDeleted).toHaveLength(3001);
  });

  it('terminates and fully erases when both tables hold near-cap data', async () => {
    const mk = (prefix: string, n: number, blob = false): FakeRow[] =>
      Array.from({ length: n }, (_, i) => ({
        _id: `${prefix}_${i}`,
        organizationId: 'o_1',
        ...(blob ? { storageId: `${prefix}b_${i}` } : {}),
      }));
    const c = createCtx({
      'userPreferences::by_organizationId': mk('p', 6100),
      'videoLinkJobs::by_organizationId_and_status': mk('v', 3100, true),
    });

    const passes = await drainToCompletion(c.ctx, 'o_1');

    expect(c.deleted).toHaveLength(6100 + 3100);
    expect(c.storageDeleted).toHaveLength(3100);
    // Bounded passes: prefs(2) + video(2) = 4 productive passes (each table
    // needs one cap pass + one remainder pass).
    expect(passes).toBe(4);
  });

  it('is a no-op (no reschedule) for an org with no personalization rows', async () => {
    const c = createCtx({});
    const r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(false);
    expect(c.deleted).toHaveLength(0);
    expect(c.scheduled).toHaveLength(0);
  });
});
