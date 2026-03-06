import { describe, expect, it, vi } from 'vitest';

import type { MutationCtx } from '../../_generated/server';

import { getOrCreateFolderPath } from '../get_or_create_path';

function createMockCtx() {
  const store = new Map<
    string,
    { _id: string; name: string; organizationId: string; parentId?: string }
  >();
  let insertCounter = 0;

  const ctx = {
    db: {
      query: vi.fn().mockImplementation(() => {
        let orgFilter: string | undefined;
        let parentFilter: string | undefined;

        const builder = {
          withIndex: vi
            .fn()
            .mockImplementation(
              (_indexName: string, cb: (q: unknown) => void) => {
                const qb = {
                  eq: vi
                    .fn()
                    .mockImplementation((field: string, value: unknown) => {
                      if (field === 'organizationId')
                        orgFilter = value as string;
                      if (field === 'parentId')
                        parentFilter = value as string | undefined;
                      return qb;
                    }),
                };
                cb(qb);
                return builder;
              },
            ),
          first: vi.fn().mockImplementation(() => {
            for (const doc of store.values()) {
              if (
                doc.organizationId === orgFilter &&
                doc.parentId === parentFilter
              ) {
                return Promise.resolve(doc);
              }
            }
            return Promise.resolve(null);
          }),
          [Symbol.asyncIterator]: () => {
            const matches = [...store.values()].filter(
              (doc) =>
                doc.organizationId === orgFilter &&
                doc.parentId === parentFilter,
            );
            let i = 0;
            return {
              next: () =>
                Promise.resolve(
                  i < matches.length
                    ? { value: matches[i++], done: false }
                    : { value: undefined, done: true },
                ),
            };
          },
        };

        return builder;
      }),
      insert: vi
        .fn()
        .mockImplementation((_table: string, doc: Record<string, unknown>) => {
          const id = `folder_${++insertCounter}`;
          store.set(id, {
            _id: id,
            name: doc.name as string,
            organizationId: doc.organizationId as string,
            parentId: doc.parentId as string | undefined,
          });
          return Promise.resolve(id);
        }),
    },
  };

  return { ctx, store };
}

describe('getOrCreateFolderPath', () => {
  it('returns undefined for empty path segments', async () => {
    const { ctx } = createMockCtx();

    const result = await getOrCreateFolderPath(
      ctx as unknown as MutationCtx,
      'org_1',
      [],
    );

    expect(result).toBeUndefined();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('creates a single folder for one segment', async () => {
    const { ctx } = createMockCtx();

    const result = await getOrCreateFolderPath(
      ctx as unknown as MutationCtx,
      'org_1',
      ['docs'],
    );

    expect(result).toBe('folder_1');
    expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    expect(ctx.db.insert).toHaveBeenCalledWith('folders', {
      organizationId: 'org_1',
      name: 'docs',
      parentId: undefined,
      createdBy: undefined,
    });
  });

  it('creates nested folders for multiple segments', async () => {
    const { ctx } = createMockCtx();

    const result = await getOrCreateFolderPath(
      ctx as unknown as MutationCtx,
      'org_1',
      ['docs', 'reports', '2024'],
    );

    expect(result).toBe('folder_3');
    expect(ctx.db.insert).toHaveBeenCalledTimes(3);
  });

  it('reuses existing folders instead of creating duplicates', async () => {
    const { ctx, store } = createMockCtx();

    // Pre-populate a folder
    store.set('existing_1', {
      _id: 'existing_1',
      name: 'docs',
      organizationId: 'org_1',
      parentId: undefined as unknown as string,
    });

    const result = await getOrCreateFolderPath(
      ctx as unknown as MutationCtx,
      'org_1',
      ['docs', 'reports'],
    );

    // Should reuse 'docs' and only create 'reports'
    expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    expect(result).toBe('folder_1');
  });

  it('passes createdBy to new folders', async () => {
    const { ctx } = createMockCtx();

    await getOrCreateFolderPath(
      ctx as unknown as MutationCtx,
      'org_1',
      ['docs'],
      'user_42',
    );

    expect(ctx.db.insert).toHaveBeenCalledWith('folders', {
      organizationId: 'org_1',
      name: 'docs',
      parentId: undefined,
      createdBy: 'user_42',
    });
  });

  it('is idempotent — calling twice produces same result', async () => {
    const { ctx } = createMockCtx();

    const first = await getOrCreateFolderPath(
      ctx as unknown as MutationCtx,
      'org_1',
      ['docs', 'reports'],
    );

    const second = await getOrCreateFolderPath(
      ctx as unknown as MutationCtx,
      'org_1',
      ['docs', 'reports'],
    );

    // Second call should reuse existing folders
    expect(first).toBe('folder_2');
    expect(second).toBe('folder_2');
    // Only 2 inserts total (first call), second call reuses
    expect(ctx.db.insert).toHaveBeenCalledTimes(2);
  });
});
