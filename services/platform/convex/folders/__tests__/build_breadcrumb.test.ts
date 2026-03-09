import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

import { buildBreadcrumb } from '../queries';

type FolderId = Id<'folders'>;

function createMockCtx(
  folders: Record<
    string,
    { name: string; parentId?: string; teamId?: string | null }
  >,
) {
  return {
    db: {
      get: vi.fn().mockImplementation((id: string) => {
        const folder = folders[id];
        if (!folder) return Promise.resolve(null);
        return Promise.resolve({
          _id: id,
          name: folder.name,
          parentId: folder.parentId,
          teamId: folder.teamId,
        });
      }),
    },
  };
}

describe('buildBreadcrumb', () => {
  it('returns single item for root folder', async () => {
    const ctx = createMockCtx({
      f1: { name: 'Documents' },
    });

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'f1' as unknown as FolderId,
    );

    expect(result).toEqual([
      { _id: 'f1', name: 'Documents', teamId: undefined },
    ]);
  });

  it('builds chain from leaf to root in correct order', async () => {
    const ctx = createMockCtx({
      f1: { name: 'Root' },
      f2: { name: 'Sub', parentId: 'f1' },
      f3: { name: 'Leaf', parentId: 'f2' },
    });

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'f3' as unknown as FolderId,
    );

    expect(result).toEqual([
      { _id: 'f1', name: 'Root', teamId: undefined },
      { _id: 'f2', name: 'Sub', teamId: undefined },
      { _id: 'f3', name: 'Leaf', teamId: undefined },
    ]);
  });

  it('returns empty array for non-existent folder', async () => {
    const ctx = createMockCtx({});

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'missing' as unknown as FolderId,
    );

    expect(result).toEqual([]);
  });

  it('stops at broken parent chain', async () => {
    const ctx = createMockCtx({
      f2: { name: 'Orphan', parentId: 'deleted' },
    });

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'f2' as unknown as FolderId,
    );

    // Should include f2 but stop when parent 'deleted' is not found
    expect(result).toEqual([{ _id: 'f2', name: 'Orphan', teamId: undefined }]);
  });

  it('detects self-referencing cycle and terminates', async () => {
    const ctx = createMockCtx({
      f1: { name: 'SelfRef', parentId: 'f1' },
    });

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'f1' as unknown as FolderId,
    );

    expect(result).toEqual([{ _id: 'f1', name: 'SelfRef', teamId: undefined }]);
  });

  it('detects A→B→A cycle and terminates', async () => {
    const ctx = createMockCtx({
      f1: { name: 'A', parentId: 'f2' },
      f2: { name: 'B', parentId: 'f1' },
    });

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'f1' as unknown as FolderId,
    );

    // Should include both but not loop forever
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result.some((b) => b._id === 'f1')).toBe(true);
  });

  it('limits depth to MAX_BREADCRUMB_DEPTH (20)', async () => {
    const folders: Record<string, { name: string; parentId?: string }> = {};
    for (let i = 1; i <= 25; i++) {
      folders[`f${i}`] = {
        name: `Level ${i}`,
        parentId: i > 1 ? `f${i - 1}` : undefined,
      };
    }
    const ctx = createMockCtx(folders);

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'f25' as unknown as FolderId,
    );

    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('includes teamId in breadcrumb items', async () => {
    const ctx = createMockCtx({
      f1: { name: 'Root', teamId: 'team_a' },
      f2: { name: 'Sub', parentId: 'f1', teamId: 'team_a' },
    });

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'f2' as unknown as FolderId,
    );

    expect(result).toEqual([
      { _id: 'f1', name: 'Root', teamId: 'team_a' },
      { _id: 'f2', name: 'Sub', teamId: 'team_a' },
    ]);
  });
});
