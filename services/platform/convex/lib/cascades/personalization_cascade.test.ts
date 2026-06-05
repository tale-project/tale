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

// The fake store is keyed by `${table}::${index}` — NOT by index name alone.
// `userMemories` and `userPreferences` both expose a `by_organizationId`
// index, so keying by index name made the two collide and the prefs delete
// path was never actually exercised (the memories sweep drained the shared
// array first). The `(table, index)` key keeps each table's rows independent.
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

  it('deletes (user, org) memories, prefs, and TTS chunks via composite indexes', async () => {
    const { ctx, deleted, storageDeleted, lastIndexUsed } = createCtx({
      'userMemories::by_user_org_status_deleted_created': [
        { _id: 'mem_1', userId: 'u_1', organizationId: 'o_1' },
        { _id: 'mem_2', userId: 'u_1', organizationId: 'o_1' },
      ],
      'userPreferences::by_userId_organizationId': [
        { _id: 'pref_1', userId: 'u_1', organizationId: 'o_1' },
      ],
      // GDPR Art 17 sweep — TTS chunks the member ever synthesized.
      'ttsAudioChunks::by_user_org': [
        {
          _id: 'tts_1',
          userId: 'u_1',
          organizationId: 'o_1',
          storageId: 'blob_1',
        },
      ],
    });

    await cascadeOnMemberRemoved(ctx, 'u_1', 'o_1');

    expect(deleted).toEqual(
      expect.arrayContaining(['mem_1', 'mem_2', 'pref_1', 'tts_1']),
    );
    expect(deleted).toHaveLength(4);
    expect(storageDeleted).toEqual(['blob_1']);
    expect(lastIndexUsed.map((u) => u.name)).toEqual([
      'by_user_org_status_deleted_created',
      'by_userId_organizationId',
      'by_user_org',
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
      'userMemories::by_organizationId': [
        { _id: 'mem_a', organizationId: 'o_1' },
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
      'userMemories::by_organizationId': [
        { _id: 'm1', organizationId: 'o_1' },
        { _id: 'm2', organizationId: 'o_1' },
      ],
      'userPreferences::by_organizationId': [
        { _id: 'p1', organizationId: 'o_1' },
      ],
      'ttsAudioChunks::by_org_createdAt': [
        { _id: 't1', organizationId: 'o_1', storageId: 'bt1' },
      ],
      'videoLinkJobs::by_organizationId_and_status': [
        { _id: 'v1', organizationId: 'o_1', storageId: 'bv1' },
      ],
    });

    // Pass 1: memories only.
    let r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toEqual(['m1', 'm2']);
    expect(c.storageDeleted).toEqual([]);

    // Pass 2: prefs only (memories now empty).
    r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toEqual(['m1', 'm2', 'p1']);

    // Pass 3: TTS only — row deleted before its blob.
    r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toEqual(['m1', 'm2', 'p1', 't1']);
    expect(c.storageDeleted).toEqual(['bt1']);
    expect(c.timeline.indexOf('del:t1')).toBeLessThan(
      c.timeline.indexOf('store:bt1'),
    );

    // Pass 4: videoLink only.
    r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toEqual(['m1', 'm2', 'p1', 't1', 'v1']);
    expect(c.storageDeleted).toEqual(['bt1', 'bv1']);

    // Pass 5: all empty → done, no further reschedule.
    r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(false);
    expect(c.scheduled).toHaveLength(4); // one per productive pass
  });

  it('caps a single pass at 6000 row-deletes for the pure-DB tables and never spills into the next table', async () => {
    const manyMemories: FakeRow[] = Array.from({ length: 6001 }, (_, i) => ({
      _id: `m_${i}`,
      organizationId: 'o_1',
    }));
    const c = createCtx({
      'userMemories::by_organizationId': manyMemories,
      'userPreferences::by_organizationId': [
        { _id: 'p1', organizationId: 'o_1' },
      ],
    });

    // Pass 1 must delete exactly the 6000-row cap and stop — prefs untouched.
    const r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toHaveLength(6000);
    expect(c.deleted).not.toContain('p1');

    // Drive the rest: the 6001st memory, then prefs, then done.
    const morePasses = await drainToCompletion(c.ctx, 'o_1');
    expect(c.deleted).toHaveLength(6002); // 6001 memories + 1 pref
    expect(c.deleted).toContain('m_6000');
    expect(c.deleted).toContain('p1');
    // 1 cap pass already counted above; remainder is bounded and small.
    expect(morePasses).toBeGreaterThanOrEqual(2);
  });

  it('caps a storage-bearing pass at 3000 rows (lower than the pure-DB cap)', async () => {
    const manyChunks: FakeRow[] = Array.from({ length: 3001 }, (_, i) => ({
      _id: `t_${i}`,
      organizationId: 'o_1',
      storageId: `b_${i}`,
    }));
    const c = createCtx({ 'ttsAudioChunks::by_org_createdAt': manyChunks });

    const r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(true);
    expect(c.deleted).toHaveLength(3000);
    expect(c.storageDeleted).toHaveLength(3000);

    await drainToCompletion(c.ctx, 'o_1');
    expect(c.deleted).toHaveLength(3001);
    expect(c.storageDeleted).toHaveLength(3001);
  });

  it('terminates and fully erases when all four tables hold near-cap data', async () => {
    const mk = (prefix: string, n: number, blob = false): FakeRow[] =>
      Array.from({ length: n }, (_, i) => ({
        _id: `${prefix}_${i}`,
        organizationId: 'o_1',
        ...(blob ? { storageId: `${prefix}b_${i}` } : {}),
      }));
    const c = createCtx({
      'userMemories::by_organizationId': mk('m', 6200),
      'userPreferences::by_organizationId': mk('p', 6100),
      'ttsAudioChunks::by_org_createdAt': mk('t', 3200, true),
      'videoLinkJobs::by_organizationId_and_status': mk('v', 3100, true),
    });

    const passes = await drainToCompletion(c.ctx, 'o_1');

    expect(c.deleted).toHaveLength(6200 + 6100 + 3200 + 3100);
    expect(c.storageDeleted).toHaveLength(3200 + 3100);
    // Bounded passes: memories(2) + prefs(2) + tts(2) + video(2) = 8 productive
    // passes (each table needs one cap pass + one remainder pass).
    expect(passes).toBe(8);
  });

  it('is a no-op (no reschedule) for an org with no personalization rows', async () => {
    const c = createCtx({});
    const r = await drainOrgPersonalizationErasureOnce(c.ctx, 'o_1');
    expect(r.rescheduled).toBe(false);
    expect(c.deleted).toHaveLength(0);
    expect(c.scheduled).toHaveLength(0);
  });
});
