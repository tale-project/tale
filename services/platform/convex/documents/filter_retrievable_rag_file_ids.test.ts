import { describe, expect, it } from 'vitest';

import { filterRetrievableRagFileIds } from './filter_retrievable_rag_file_ids';

function createCtx(
  metadataByFile: Record<string, Record<string, unknown>>,
  documentsById: Record<string, Record<string, unknown>>,
) {
  return {
    db: {
      query: () => ({
        withIndex: (
          _name: string,
          bind: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          let storageId = '';
          const q = {
            eq(field: string, value: unknown) {
              if (field === 'storageId') storageId = String(value);
              return q;
            },
          };
          bind(q);
          return {
            first: async () => metadataByFile[storageId] ?? null,
          };
        },
      }),
      get: async (id: string) => documentsById[id] ?? null,
    },
  } as never;
}

describe('filterRetrievableRagFileIds', () => {
  it('keeps only completed rows still bound to the current active document file', async () => {
    const ctx = createCtx(
      {
        current: {
          organizationId: 'org',
          storageId: 'current',
          documentId: 'doc-current',
          ragStatus: 'completed',
        },
        running: {
          organizationId: 'org',
          storageId: 'running',
          documentId: 'doc-running',
          ragStatus: 'running',
        },
        stale: {
          organizationId: 'org',
          storageId: 'stale',
          documentId: 'doc-stale',
          ragStatus: 'completed',
        },
      },
      {
        'doc-current': {
          _id: 'doc-current',
          organizationId: 'org',
          fileId: 'current',
        },
        'doc-running': {
          _id: 'doc-running',
          organizationId: 'org',
          fileId: 'running',
        },
        'doc-stale': {
          _id: 'doc-stale',
          organizationId: 'org',
          fileId: 'newer',
        },
      },
    );

    expect(
      await filterRetrievableRagFileIds(ctx, {
        organizationId: 'org',
        fileIds: ['current', 'running', 'stale'],
      }),
    ).toEqual(['current']);
  });

  it('rechecks current folder and access instead of trusting stale SQL scope', async () => {
    const ctx = createCtx(
      {
        scoped: {
          organizationId: 'org',
          storageId: 'scoped',
          documentId: 'doc',
          ragStatus: 'completed',
        },
      },
      {
        doc: {
          _id: 'doc',
          organizationId: 'org',
          fileId: 'scoped',
          folderPath: '/current',
          teamTags: ['team-current'],
        },
      },
    );

    expect(
      await filterRetrievableRagFileIds(ctx, {
        organizationId: 'org',
        fileIds: ['scoped'],
        folder: '/old',
        access: {
          teamIds: ['team-old'],
          projectIds: [],
          includeHub: false,
        },
      }),
    ).toEqual([]);
  });
});
