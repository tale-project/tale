import { describe, expect, it } from 'vitest';

import type { QueryCtx } from '../../_generated/server';
import { findFolderByPath } from '../find_folder_by_path';

interface MockFolder {
  _id: string;
  name: string;
  organizationId: string;
  parentId?: string;
}

function createMockCtx(folders: MockFolder[]) {
  return {
    db: {
      query: () => ({
        withIndex: (
          _indexName: string,
          cb: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          let orgFilter: string | undefined;
          let parentFilter: string | undefined;
          let nameFilter: string | undefined;

          const qb = {
            eq: (field: string, value: unknown) => {
              if (field === 'organizationId') orgFilter = value as string;
              if (field === 'parentId')
                parentFilter = value as string | undefined;
              if (field === 'name') nameFilter = value as string;
              return qb;
            },
          };
          cb(qb);

          return {
            first: () => {
              for (const doc of folders) {
                if (
                  doc.organizationId === orgFilter &&
                  doc.parentId === parentFilter &&
                  (nameFilter === undefined || doc.name === nameFilter)
                ) {
                  return Promise.resolve(doc);
                }
              }
              return Promise.resolve(null);
            },
          };
        },
      }),
    },
  };
}

const ORG = 'org1';

describe('findFolderByPath', () => {
  it('returns null for empty path', async () => {
    const ctx = createMockCtx([]);
    const result = await findFolderByPath(ctx as unknown as QueryCtx, ORG, []);
    expect(result).toBeNull();
  });

  it('returns null when path is whitespace-only', async () => {
    const ctx = createMockCtx([]);
    const result = await findFolderByPath(ctx as unknown as QueryCtx, ORG, [
      '  ',
      '\t',
    ]);
    expect(result).toBeNull();
  });

  it('returns the leaf id for an existing nested path', async () => {
    const ctx = createMockCtx([
      { _id: 'f1', name: 'A', organizationId: ORG, parentId: undefined },
      { _id: 'f2', name: 'B', organizationId: ORG, parentId: 'f1' },
      { _id: 'f3', name: 'C', organizationId: ORG, parentId: 'f2' },
    ]);
    const result = await findFolderByPath(ctx as unknown as QueryCtx, ORG, [
      'A',
      'B',
      'C',
    ]);
    expect(result).toBe('f3');
  });

  it('returns null when an intermediate folder is missing', async () => {
    const ctx = createMockCtx([
      { _id: 'f1', name: 'A', organizationId: ORG, parentId: undefined },
      // Missing 'B'
      { _id: 'f3', name: 'C', organizationId: ORG, parentId: 'f2' },
    ]);
    const result = await findFolderByPath(ctx as unknown as QueryCtx, ORG, [
      'A',
      'B',
      'C',
    ]);
    expect(result).toBeNull();
  });

  it('returns null when a segment fails the validator', async () => {
    const ctx = createMockCtx([]);
    // '..' is reserved → validator throws → helper returns null without writing.
    const result = await findFolderByPath(ctx as unknown as QueryCtx, ORG, [
      'A',
      '..',
    ]);
    expect(result).toBeNull();
  });

  it('does not insert any folders (read-only)', async () => {
    let inserts = 0;
    const ctx = {
      db: {
        query: () => ({
          withIndex: (
            _idx: string,
            cb: (q: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) => {
            const qb = { eq: () => qb };
            cb(qb);
            return { first: () => Promise.resolve(null) };
          },
        }),
        insert: () => {
          inserts++;
          return Promise.resolve('should-not-happen');
        },
      },
    };
    await findFolderByPath(ctx as unknown as QueryCtx, ORG, ['NewFolder']);
    expect(inserts).toBe(0);
  });
});
