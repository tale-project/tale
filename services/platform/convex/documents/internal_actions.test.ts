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

function makeCtx(fileId: string): ActionContext {
  return {
    runAction: vi.fn(async () => null),
    runMutation: vi.fn(async () => null),
    runQuery: vi.fn(async () => ({
      _id: 'doc_1',
      organizationId: 'org_1',
      fileId,
      title: 'Policy',
      mimeType: 'application/pdf',
      folderPath: 'policies',
      teamTags: ['team_1'],
      projectId: 'project_1',
    })),
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
