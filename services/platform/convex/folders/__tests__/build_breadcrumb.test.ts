import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

import { buildBreadcrumb } from '../queries';

type FolderId = Id<'folders'>;

function createMockCtx(
  folders: Record<string, { name: string; parentId?: string }>,
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

    expect(result).toEqual([{ _id: 'f1', name: 'Documents' }]);
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
      { _id: 'f1', name: 'Root' },
      { _id: 'f2', name: 'Sub' },
      { _id: 'f3', name: 'Leaf' },
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
    expect(result).toEqual([{ _id: 'f2', name: 'Orphan' }]);
  });

  it('detects self-referencing cycle and terminates', async () => {
    const ctx = createMockCtx({
      f1: { name: 'SelfRef', parentId: 'f1' },
    });

    const result = await buildBreadcrumb(
      ctx as unknown as QueryCtx,
      'f1' as unknown as FolderId,
    );

    expect(result).toEqual([{ _id: 'f1', name: 'SelfRef' }]);
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
});
