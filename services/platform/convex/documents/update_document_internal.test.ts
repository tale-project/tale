import { describe, expect, it } from 'vitest';

import {
  replaceControlledDocumentContentInternal,
  updateDocumentInternal,
} from './update_document_internal';

type Doc = Record<string, unknown> & { _id: string; fileId?: string };

/**
 * Mock ctx for the reindex gate. The gate reads canonical RAG status from
 * `fileMetadata` (`by_storageId` .first()) for the doc's CURRENT blob and only
 * schedules `reindexDocumentInRag` when that blob is completed AND the file or
 * title changed.
 */
function createMockCtx(
  document: Doc,
  fm: Record<string, unknown> | null,
  folders: Record<string, Record<string, unknown>> = {},
) {
  const patches: Array<{ id: string; data: Record<string, unknown> }> = [];
  const scheduled: Array<{ args: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      get: async (id: unknown) =>
        id === document._id ? document : (folders[String(id)] ?? null),
      query: () => {
        let storageId: unknown;
        const q = {
          eq: (field: string, value: unknown) => {
            if (field === 'storageId') storageId = value;
            return q;
          },
        };
        return {
          withIndex: (_idx: string, cb: (qq: unknown) => unknown) => {
            cb(q);
            return {
              first: async () => (storageId === document.fileId ? fm : null),
            };
          },
        };
      },
      patch: async (id: string, data: Record<string, unknown>) => {
        patches.push({ id, data });
      },
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        _ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ args });
      },
    },
  } as unknown as Parameters<typeof updateDocumentInternal>[0];

  return { ctx, patches, scheduled };
}

const baseDoc: Doc = {
  _id: 'd1',
  fileId: 's1',
  organizationId: 'org1',
  title: 'Old title',
  contentHash: 'oldhash',
};

describe('updateDocumentInternal reindex gate', () => {
  it('schedules content reindex when hash + file changed on a completed blob', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'completed' },
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      contentHash: 'newhash',
      fileId: 's2',
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual({
      documentId: 'd1',
      oldFileId: 's1',
      oldOrganizationId: 'org1',
    });
  });

  it('schedules title reindex on a title-only rename of a completed blob', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'completed' },
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      title: 'New title',
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toMatchObject({
      documentId: 'd1',
      oldFileId: 's1',
    });
  });

  it('schedules first-time indexing when content changes on a queued blob', async () => {
    const { ctx, scheduled, patches } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'queued' },
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      contentHash: 'newhash',
      fileId: 's2',
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual({
      documentId: 'd1',
      expectedFileId: 's2',
    });
    expect(patches).toHaveLength(1);
  });

  it('does NOT index while a blob is actively running', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'running' },
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      contentHash: 'newhash',
      fileId: 's2',
    });

    expect(scheduled).toHaveLength(0);
  });

  it('defers replacement indexing to the shared admission controller', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'running' },
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      contentHash: 'newhash',
      fileId: 's2',
      deferContentReindex: true,
    });

    expect(scheduled).toHaveLength(0);
  });

  it('schedules first-time indexing when content changes on a never-indexed doc', async () => {
    const { ctx, scheduled } = createMockCtx({ ...baseDoc }, null);

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      contentHash: 'newhash',
      fileId: 's2',
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual({
      documentId: 'd1',
      expectedFileId: 's2',
    });
  });

  it('does NOT reindex a legacy completed doc with no fileMetadata row (migration window)', async () => {
    const { ctx, scheduled } = createMockCtx({ ...baseDoc }, null);

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      title: 'New title',
    });

    expect(scheduled).toHaveLength(0);
  });

  it('does NOT reindex when neither file content nor title changed', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'completed' },
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      mimeType: 'application/pdf',
    });

    expect(scheduled).toHaveLength(0);
  });
});

describe('updateDocumentInternal folder-move RAG sync', () => {
  const contractsFolder = {
    f1: { _id: 'f1', name: 'Contracts', organizationId: 'org1' },
  };

  it('schedules syncRagFolderPaths on a folder move of an indexed doc', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'completed' },
      contractsFolder,
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      folderId: 'f1' as never,
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual({
      organizationId: 'org1',
      updates: [{ fileId: 's1', folderPath: 'Contracts' }],
    });
  });

  it('does NOT sync folder paths when the doc is not indexed', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'queued' },
      contractsFolder,
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      folderId: 'f1' as never,
    });

    expect(scheduled).toHaveLength(0);
  });

  it('does NOT sync when folderId is unchanged', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc, folderId: 'f1' },
      { ragStatus: 'completed' },
      contractsFolder,
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      folderId: 'f1' as never,
    });

    expect(scheduled).toHaveLength(0);
  });

  it('skips the folder sync when a reindex is scheduled (re-upload carries the path)', async () => {
    const { ctx, scheduled } = createMockCtx(
      { ...baseDoc },
      { ragStatus: 'completed' },
      contractsFolder,
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      contentHash: 'newhash',
      fileId: 's2',
      folderId: 'f1' as never,
    });

    // Only the reindex is scheduled — not a duplicate folder-path sync.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toMatchObject({ documentId: 'd1' });
  });
});

describe('updateDocumentInternal project-doc scope invariant', () => {
  it('rejects team assignment on a project-scoped document', async () => {
    const { ctx, patches } = createMockCtx(
      { ...baseDoc, projectId: 'proj_1' },
      null,
    );

    await expect(
      updateDocumentInternal(ctx, {
        documentId: 'd1' as never,
        teamId: 'team_1',
      }),
    ).rejects.toMatchObject({ data: { code: 'DOCUMENT_SCOPE_CONFLICT' } });
    expect(patches).toHaveLength(0);
  });

  it('still allows non-team updates on a project-scoped document', async () => {
    const { ctx, patches } = createMockCtx(
      { ...baseDoc, projectId: 'proj_1' },
      null,
    );

    await updateDocumentInternal(ctx, {
      documentId: 'd1' as never,
      title: 'Renamed inside project',
    });

    expect(patches).toHaveLength(1);
    expect(patches[0].data).toMatchObject({ title: 'Renamed inside project' });
  });
});

describe('updateDocumentInternal controlled-content gate', () => {
  it('requires the dedicated flow for a controlled draft', async () => {
    const { ctx, patches, scheduled } = createMockCtx(
      { ...baseDoc, record: { state: 'draft' } },
      { ragStatus: 'completed' },
    );

    await expect(
      updateDocumentInternal(ctx, {
        documentId: 'd1' as never,
        contentHash: 'newhash',
        fileId: 's2',
      }),
    ).rejects.toMatchObject({
      data: { code: 'DOCUMENT_RECORD_REPLACEMENT_REQUIRED' },
    });
    expect(patches).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it('preserves the frozen-state error for approved content', async () => {
    const { ctx, patches } = createMockCtx(
      { ...baseDoc, record: { state: 'approved' } },
      null,
    );

    await expect(
      updateDocumentInternal(ctx, {
        documentId: 'd1' as never,
        fileId: 's2',
      }),
    ).rejects.toMatchObject({ data: { code: 'DOCUMENT_RECORD_FROZEN' } });
    expect(patches).toHaveLength(0);
  });

  it('keeps the replacement-only seam available to the attested binder', async () => {
    const { ctx, patches, scheduled } = createMockCtx(
      { ...baseDoc, record: { state: 'draft' } },
      { ragStatus: 'completed' },
    );

    await replaceControlledDocumentContentInternal(ctx, {
      documentId: 'd1' as never,
      contentHash: 'newhash',
      fileId: 's2',
      deferContentReindex: true,
    });

    expect(patches).toHaveLength(1);
    expect(patches[0].data).toMatchObject({
      fileId: 's2',
      contentHash: 'newhash',
    });
    expect(scheduled).toHaveLength(0);
  });
});
