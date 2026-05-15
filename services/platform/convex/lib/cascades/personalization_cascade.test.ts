import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  cascadeOnMemberRemoved,
  cascadeOnOrgDeleted,
} from './personalization_cascade';

interface FakeRow {
  _id: string;
  userId?: string;
  organizationId?: string;
}

function createCtx(rowsByIndex: Record<string, FakeRow[]>) {
  const deleted: string[] = [];
  const lastIndexUsed: { name: string; eq: Record<string, unknown> }[] = [];

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
            };
          },
        };
      }),
      delete: vi.fn(async (id: string) => {
        deleted.push(id);
      }),
    },
  } as never;

  return { ctx, deleted, lastIndexUsed };
}

describe('cascadeOnMemberRemoved', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes (user, org) memories and prefs via the composite index', async () => {
    const { ctx, deleted, lastIndexUsed } = createCtx({
      by_user_org_status_deleted_created: [
        { _id: 'mem_1', userId: 'u_1', organizationId: 'o_1' },
        { _id: 'mem_2', userId: 'u_1', organizationId: 'o_1' },
      ],
      by_userId_organizationId: [
        { _id: 'pref_1', userId: 'u_1', organizationId: 'o_1' },
      ],
    });

    await cascadeOnMemberRemoved(ctx, 'u_1', 'o_1');

    expect(deleted).toEqual(
      expect.arrayContaining(['mem_1', 'mem_2', 'pref_1']),
    );
    expect(deleted).toHaveLength(3);
    expect(lastIndexUsed.map((u) => u.name)).toEqual([
      'by_user_org_status_deleted_created',
      'by_userId_organizationId',
    ]);
  });

  it('is a no-op when the user has no rows', async () => {
    const { ctx, deleted } = createCtx({});
    await cascadeOnMemberRemoved(ctx, 'u_1', 'o_1');
    expect(deleted).toHaveLength(0);
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
    expect(lastIndexUsed).toHaveLength(3);
    expect(deleted).toEqual(
      expect.arrayContaining(['mem_a', 'mem_b', 'pref_a', 'tts_a']),
    );
  });
});
