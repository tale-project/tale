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

  it('uses the by_organizationId index (not a full-table filter scan)', async () => {
    const { ctx, deleted, lastIndexUsed } = createCtx({
      by_organizationId: [
        { _id: 'mem_a', organizationId: 'o_1' },
        { _id: 'mem_b', organizationId: 'o_1' },
        { _id: 'pref_a', organizationId: 'o_1' },
      ],
    });

    await cascadeOnOrgDeleted(ctx, 'o_1');

    // Both queries (memories + prefs) must use by_organizationId; the
    // pre-fix code path used .filter() which is a scan, not an index.
    expect(lastIndexUsed.every((u) => u.name === 'by_organizationId')).toBe(
      true,
    );
    expect(lastIndexUsed).toHaveLength(2);
    expect(deleted).toEqual(
      expect.arrayContaining(['mem_a', 'mem_b', 'pref_a']),
    );
  });
});
