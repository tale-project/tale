import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  internalAction: (config: Record<string, unknown>) => config,
}));

vi.mock('../_generated/api', () => ({
  internal: {
    documents: {
      internal_queries: { getDocumentByIdRaw: 'getDocumentByIdRaw' },
    },
    file_metadata: {
      internal_mutations: {
        ensureFileMetadataForDocument: 'ensureFileMetadataForDocument',
        updateFileRagStatus: 'updateFileRagStatus',
      },
      internal_queries: { getByStorageId: 'getByStorageId' },
    },
  },
}));

const { indexFileBlobMock } = vi.hoisted(() => ({
  indexFileBlobMock: vi.fn(async () => undefined),
}));

vi.mock('../knowledge/ingest_file', () => ({
  indexFileBlob: indexFileBlobMock,
}));

const { reindexDocumentInRag, uploadDocumentToRag } =
  await import('./internal_actions');

interface ActionContext {
  runAction: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
  runQuery: ReturnType<typeof vi.fn>;
}

interface ActionRegistration<Args> {
  handler: (ctx: ActionContext, args: Args) => Promise<null>;
}

function handler<Args>(registration: unknown) {
  return (registration as ActionRegistration<Args>).handler;
}

function makeCtx(
  fileId: string,
  fileMetadata: Record<string, unknown> | null = null,
): ActionContext {
  return {
    runAction: vi.fn(async () => null),
    runMutation: vi.fn(async () => null),
    // Routed by the mocked function name: the document read answers the doc,
    // the fileMetadata read answers the (optional) row.
    runQuery: vi.fn(async (name: unknown) =>
      name === 'getByStorageId'
        ? fileMetadata
        : {
            _id: 'doc_1',
            organizationId: 'org_1',
            fileId,
            title: 'Policy',
            mimeType: 'application/pdf',
            folderPath: 'policies',
            teamTags: ['team_1'],
            projectId: 'project_1',
          },
    ),
  };
}

describe('document RAG generation fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses an admitted file after the document moves to a newer file', async () => {
    const ctx = makeCtx('blob_C');

    await handler<{ documentId: string; expectedFileId: string }>(
      uploadDocumentToRag,
    )(ctx, {
      documentId: 'doc_1',
      expectedFileId: 'blob_B',
    });

    expect(indexFileBlobMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledOnce();
    expect(ctx.runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 'blob_B',
      ragStatus: 'failed',
      ragError: 'Indexing stopped because this file was replaced.',
    });
  });

  it('refuses a file persisted with skipRagIndexing without touching the row', async () => {
    // Defense in depth: the scheduling sites already refuse flagged rows, but
    // this action is reachable directly (REST retry-indexing, a first-time
    // index scheduled by a document update) — the executor refuses too.
    const ctx = makeCtx('blob_B', { skipRagIndexing: true });

    await handler<{ documentId: string; expectedFileId: string }>(
      uploadDocumentToRag,
    )(ctx, {
      documentId: 'doc_1',
      expectedFileId: 'blob_B',
    });

    expect(indexFileBlobMock).not.toHaveBeenCalled();
    // No status write, no ensure — the row stays exactly as it was.
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('indexes an unflagged file (ensures the bookkeeping row first)', async () => {
    const ctx = makeCtx('blob_B', null);

    await handler<{ documentId: string; expectedFileId: string }>(
      uploadDocumentToRag,
    )(ctx, {
      documentId: 'doc_1',
      expectedFileId: 'blob_B',
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'ensureFileMetadataForDocument',
      expect.objectContaining({ storageId: 'blob_B', documentId: 'doc_1' }),
    );
    expect(indexFileBlobMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ storageId: 'blob_B', documentId: 'doc_1' }),
    );
  });

  it('retains a replaced corpus blob that a sibling document may share', async () => {
    const ctx = makeCtx('blob_C');

    await handler<{
      documentId: string;
      oldFileId: string;
      oldOrganizationId: string;
    }>(reindexDocumentInRag)(ctx, {
      documentId: 'doc_1',
      oldFileId: 'blob_B',
      oldOrganizationId: 'org_1',
    });

    expect(indexFileBlobMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        documentId: 'doc_1',
        organizationId: 'org_1',
        storageId: 'blob_C',
      }),
    );
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});
