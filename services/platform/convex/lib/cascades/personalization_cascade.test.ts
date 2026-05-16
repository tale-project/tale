import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  cascadeOnMemberRemoved,
  cascadeOnOrgDeleted,
} from './personalization_cascade';

interface FakeRow {
  _id: string;
  userId?: string;
  organizationId?: string;
  storageId?: string;
}

function createCtx(rowsByIndex: Record<string, FakeRow[]>) {
  const deleted: string[] = [];
  const storageDeleted: string[] = [];
  const lastIndexUsed: { name: string; eq: Record<string, unknown> }[] = [];
  // Each `take()` empties the per-index store so a paged loop terminates
  // after one call — matches the real Convex behaviour for a single page.
  const remaining: Record<string, FakeRow[]> = {};
  for (const [k, v] of Object.entries(rowsByIndex)) {
    remaining[k] = [...v];
  }

  const ctx = {
    db: {
      query: vi.fn((_table: string) => {
        return {
          withIndex: (indexName: string, cb: (q: unknown) => unknown) => {
            const eqState: Record<string, unknown> = {};
            const builder: unknown = {
              eq: (field: string, value: unknown) => {
                eqState[field] = value;
                return builder;
              },
            };
            cb(builder);
            lastIndexUsed.push({ name: indexName, eq: { ...eqState } });
            return {
              collect: async (): Promise<FakeRow[]> =>
                rowsByIndex[indexName] ?? [],
              take: async (n: number): Promise<FakeRow[]> => {
                const rows = remaining[indexName] ?? [];
                const slice = rows.splice(0, n);
                return slice;
              },
            };
          },
        };
      }),
      delete: vi.fn(async (id: string) => {
        deleted.push(id);
      }),
    },
    storage: {
      delete: vi.fn(async (id: string) => {
        storageDeleted.push(id);
      }),
    },
  } as never;

  return { ctx, deleted, storageDeleted, lastIndexUsed };
}

describe('cascadeOnMemberRemoved', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes (user, org) memories, prefs, and TTS chunks via composite indexes', async () => {
    const { ctx, deleted, storageDeleted, lastIndexUsed } = createCtx({
      by_user_org_status_deleted_created: [
        { _id: 'mem_1', userId: 'u_1', organizationId: 'o_1' },
        { _id: 'mem_2', userId: 'u_1', organizationId: 'o_1' },
      ],
      by_userId_organizationId: [
        { _id: 'pref_1', userId: 'u_1', organizationId: 'o_1' },
      ],
      // GDPR Art 17 sweep — TTS chunks the member ever synthesized.
      by_user_org: [
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
    // Blob delete fires for the chunk row that carried a `storageId`.
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

  it('uses indexed paths (no full-table filter scans)', async () => {
    const { ctx, deleted, lastIndexUsed } = createCtx({
      by_organizationId: [
        { _id: 'mem_a', organizationId: 'o_1' },
        { _id: 'mem_b', organizationId: 'o_1' },
        { _id: 'pref_a', organizationId: 'o_1' },
      ],
      by_org_createdAt: [{ _id: 'tts_a', organizationId: 'o_1' }],
    });

    await cascadeOnOrgDeleted(ctx, 'o_1');

    // Every query must hit an index (no full-table scan): memories + prefs
    // use `by_organizationId`; TTS chunks use `by_org_createdAt` because
    // that's the only index on the chunks table that fronts organizationId.
    const indexedNames = new Set(['by_organizationId', 'by_org_createdAt']);
    expect(lastIndexUsed.every((u) => indexedNames.has(u.name))).toBe(true);
    // 1 query each for memories + prefs (collect path), then the TTS sweep
    // pages via `by_org_createdAt` — terminates after one page when the
    // returned slice is shorter than PAGE_SIZE.
    expect(lastIndexUsed).toHaveLength(3);
    expect(deleted).toEqual(
      expect.arrayContaining(['mem_a', 'mem_b', 'pref_a', 'tts_a']),
    );
  });
});
