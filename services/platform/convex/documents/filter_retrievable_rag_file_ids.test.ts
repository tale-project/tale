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

  describe('thread-bound chat uploads', () => {
    const threadUpload = (overrides: Record<string, unknown> = {}) => ({
      organizationId: 'org',
      storageId: 'chat-file',
      threadId: 'thread_a',
      ragStatus: 'completed',
      ...overrides,
    });
    const access = (threadIds?: string[]) => ({
      teamIds: [],
      projectIds: [],
      includeHub: true,
      ...(threadIds !== undefined ? { threadIds } : {}),
    });

    it('returns a completed upload to a caller whose access lists its thread', async () => {
      const ctx = createCtx({ 'chat-file': threadUpload() }, {});
      expect(
        await filterRetrievableRagFileIds(ctx, {
          organizationId: 'org',
          fileIds: ['chat-file'],
          access: access(['thread_a']),
        }),
      ).toEqual(['chat-file']);
    });

    it('refuses a foreign thread, an unlisted caller, and an org-wide caller', async () => {
      const ctx = createCtx({ 'chat-file': threadUpload() }, {});
      const base = {
        organizationId: 'org',
        fileIds: ['chat-file'] as string[],
      };
      expect(
        await filterRetrievableRagFileIds(ctx, {
          ...base,
          access: access(['thread_other']),
        }),
      ).toEqual([]);
      expect(
        await filterRetrievableRagFileIds(ctx, { ...base, access: access() }),
      ).toEqual([]);
      // Absent access = org-wide (admin) caller — a thread upload is private
      // to its thread and must NOT surface there.
      expect(await filterRetrievableRagFileIds(ctx, base)).toEqual([]);
    });

    it('still requires completion, lifecycle, and org — thread scope is not a bypass', async () => {
      const ctx = createCtx(
        {
          queued: threadUpload({ storageId: 'queued', ragStatus: 'queued' }),
          trashed: threadUpload({
            storageId: 'trashed',
            lifecycleStatus: 'trashed',
          }),
          foreign: threadUpload({
            storageId: 'foreign',
            organizationId: 'org_other',
          }),
        },
        {},
      );
      expect(
        await filterRetrievableRagFileIds(ctx, {
          organizationId: 'org',
          fileIds: ['queued', 'trashed', 'foreign'],
          access: access(['thread_a']),
        }),
      ).toEqual([]);
    });

    it('never returns thread uploads for a folder-scoped search', async () => {
      const ctx = createCtx({ 'chat-file': threadUpload() }, {});
      expect(
        await filterRetrievableRagFileIds(ctx, {
          organizationId: 'org',
          fileIds: ['chat-file'],
          folder: 'contracts',
          access: access(['thread_a']),
        }),
      ).toEqual([]);
    });

    it('a thread-bound row with a documentId still reads as a thread upload', async () => {
      // Mirrors the dispatcher (`isCurrentHubRow`): `threadId` wins. The
      // document row must not grant hub visibility to a chat upload.
      const ctx = createCtx(
        { 'chat-file': threadUpload({ documentId: 'doc' }) },
        { doc: { _id: 'doc', organizationId: 'org', fileId: 'chat-file' } },
      );
      expect(
        await filterRetrievableRagFileIds(ctx, {
          organizationId: 'org',
          fileIds: ['chat-file'],
        }),
      ).toEqual([]);
      expect(
        await filterRetrievableRagFileIds(ctx, {
          organizationId: 'org',
          fileIds: ['chat-file'],
          access: access(['thread_a']),
        }),
      ).toEqual(['chat-file']);
    });
  });
});
