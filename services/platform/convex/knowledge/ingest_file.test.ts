import { beforeEach, describe, expect, it, vi } from 'vitest';

// The orchestration under test is `indexFileBlob`'s decision tree — which
// status lands for which outcome. Its collaborators (extraction, the corpus
// writer, the pool, the embedder) are each proven by their own suites and
// faked here.

vi.mock('../_generated/api', () => ({
  internal: {
    documents: {
      internal_queries: { getDocumentByIdRaw: 'getDocumentByIdRaw' },
    },
    file_metadata: {
      internal_mutations: { updateFileRagStatus: 'updateFileRagStatus' },
      internal_actions: { uploadFileToRag: 'uploadFileToRag' },
    },
  },
}));

vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: vi.fn(async (_ctx: unknown, orgId: string) =>
    orgId === 'org_gone' ? null : 'acme',
  ),
}));

const readBlobBytesMock = vi.fn(async () =>
  new TextEncoder().encode('hello corpus world'),
);
vi.mock('../lib/storage/blob_access', () => ({
  readBlobBytes: (...args: unknown[]) => readBlobBytesMock(...(args as [])),
}));

const extractTextMock = vi.fn(
  async (): Promise<[string, boolean]> => ['hello corpus world', false],
);
vi.mock('../lib/knowledge/extraction/router', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('../lib/knowledge/extraction/router')>();
  return {
    ...mod,
    extractText: (...args: unknown[]) => extractTextMock(...(args as [])),
  };
});

vi.mock('./connection', () => ({
  readOrgEmbeddingConfig: vi.fn(async () => ({
    providerSlug: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 4,
  })),
}));

const embedderForOrgMock = vi.fn(async () => ({ dimensions: 4 }));
vi.mock('./embedding', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./embedding')>();
  return {
    ...mod,
    embedderForOrg: (...args: unknown[]) => embedderForOrgMock(...(args as [])),
  };
});

vi.mock('./pool', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./pool')>();
  return {
    ...mod,
    getKnowledgePoolForOrg: vi.fn(async () => ({}) as never),
    resolveOrgUrl: vi.fn(async () => 'postgresql://fake'),
  };
});

vi.mock('./dimensions', () => ({
  pinDimensions: vi.fn(async () => undefined),
}));

const indexDocumentMock = vi.fn();
vi.mock('./indexing', () => ({
  indexDocument: (...args: unknown[]) => indexDocumentMock(...(args as [])),
}));

const { indexFileBlob } = await import('./ingest_file');

const ARGS = {
  organizationId: 'org_1',
  storageId: 'blob_1',
  fileName: 'notes.txt',
  contentType: 'text/plain',
};

function createCtx(currentFileIds: string[] = ['blob_1']) {
  const statusWrites: Array<Record<string, unknown>> = [];
  const scheduled: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const deleted: Array<Record<string, unknown>> = [];
  let currentRead = 0;
  const ctx = {
    runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      statusWrites.push(args);
      return null;
    }),
    runQuery: vi.fn(async () => {
      const fileId =
        currentFileIds[Math.min(currentRead, currentFileIds.length - 1)];
      currentRead += 1;
      return { _id: 'doc_1', fileId };
    }),
    runAction: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      deleted.push(args);
      return null;
    }),
    scheduler: {
      runAfter: vi.fn(
        async (_delay: number, ref: unknown, args: Record<string, unknown>) => {
          scheduled.push({ ref, args });
          return 'job_1';
        },
      ),
    },
  };
  return { ctx: ctx as never, statusWrites, scheduled, deleted };
}

function completedResult(chunksTotal = 3) {
  return {
    fileId: 'blob_1',
    chunksWritten: chunksTotal,
    chunksTotal,
    partial: false,
  };
}

beforeEach(() => {
  indexDocumentMock.mockReset();
  extractTextMock.mockReset();
  extractTextMock.mockResolvedValue(['hello corpus world', false]);
  readBlobBytesMock.mockClear();
  embedderForOrgMock.mockClear();
});

describe('indexFileBlob — outcome → status', () => {
  it('marks running with progress, then completed on a full index', async () => {
    indexDocumentMock.mockResolvedValueOnce(completedResult());
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, ARGS);

    expect(statusWrites[0]).toMatchObject({
      ragStatus: 'running',
      ragProgress: 'Extracting text…',
    });
    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'completed' });
  });

  it('treats unchanged content as success — dedup is not an error', async () => {
    indexDocumentMock.mockResolvedValueOnce({
      ...completedResult(),
      chunksWritten: 0,
      skipped: 'unchanged',
    });
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, ARGS);

    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'completed' });
  });

  it('marks images unsupported — the OCR/vision arm is not back yet', async () => {
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, { ...ARGS, fileName: 'scan.png' });

    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'unsupported' });
    expect(indexDocumentMock).not.toHaveBeenCalled();
  });

  it('marks a format with no extractor unsupported, naming the suffix', async () => {
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, { ...ARGS, fileName: 'archive.zip' });

    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'unsupported' });
    expect(String(statusWrites.at(-1)?.ragError)).toContain('.zip');
  });

  it('fails with the scanned-document explanation when no text extracts', async () => {
    extractTextMock.mockResolvedValueOnce(['   ', false]);
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, { ...ARGS, fileName: 'scanned.pdf' });

    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'failed' });
    expect(String(statusWrites.at(-1)?.ragError)).toMatch(/OCR/);
  });

  it('fails with the embedding-config message when no model is configured', async () => {
    const { EmbeddingNotConfigured } = await import('./embedding');
    embedderForOrgMock.mockRejectedValueOnce(
      new EmbeddingNotConfigured('acme'),
    );
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, ARGS);

    expect(statusWrites.at(-1)).toMatchObject({
      ragStatus: 'failed',
      // The stable code (pinned: it lives on persisted rows) drives the
      // failed dialog's deep link to the embedding settings.
      ragErrorCode: 'embedding_not_configured',
    });
    expect(String(statusWrites.at(-1)?.ragError)).toMatch(
      /no embedding model/i,
    );
  });

  it('fails with the secret-scan refusal, verbatim', async () => {
    indexDocumentMock.mockResolvedValueOnce({
      fileId: 'blob_1',
      chunksWritten: 0,
      chunksTotal: 0,
      partial: false,
      skipped: 'secret-detected',
      refusal: 'The file looks like it contains a private key.',
    });
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, ARGS);

    expect(statusWrites.at(-1)).toMatchObject({
      ragStatus: 'failed',
      ragError: 'The file looks like it contains a private key.',
    });
  });

  it('fails (never throws) when the corpus writer blows up', async () => {
    indexDocumentMock.mockRejectedValueOnce(new Error('pool exhausted'));
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, ARGS);

    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'failed' });
    expect(String(statusWrites.at(-1)?.ragError)).toContain('pool exhausted');
    // Only the guidable embedding-config failure carries a code.
    expect(statusWrites.at(-1)?.ragErrorCode).toBeUndefined();
  });

  it('fails when the organization is unresolvable', async () => {
    const { ctx, statusWrites } = createCtx();

    await indexFileBlob(ctx, { ...ARGS, organizationId: 'org_gone' });

    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'failed' });
    expect(indexDocumentMock).not.toHaveBeenCalled();
  });

  it('stops a generation replaced before extraction without purging its shared blob', async () => {
    const { ctx, statusWrites, deleted } = createCtx(['blob_2']);

    await indexFileBlob(ctx, {
      ...ARGS,
      documentId: 'doc_1' as never,
    });

    expect(indexDocumentMock).not.toHaveBeenCalled();
    expect(statusWrites.at(-1)).toMatchObject({
      ragStatus: 'failed',
      ragError: 'Indexing stopped because this file was replaced.',
    });
    // D2 may still point at blob_1. Without reverse-reference accounting,
    // preserving the corpus row is safer than deleting sibling knowledge.
    expect(deleted).toEqual([]);
  });

  it('never exposes completed when replacement lands during a slice', async () => {
    indexDocumentMock.mockResolvedValueOnce(completedResult());
    const { ctx, statusWrites, deleted } = createCtx([
      'blob_1',
      'blob_1',
      'blob_1',
      'blob_1',
      'blob_2',
    ]);

    await indexFileBlob(ctx, {
      ...ARGS,
      documentId: 'doc_1' as never,
    });

    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'failed' });
    expect(statusWrites).not.toContainEqual(
      expect.objectContaining({ ragStatus: 'completed' }),
    );
    expect(deleted).toEqual([]);
  });
});

describe('indexFileBlob — slices', () => {
  it('loops partial slices in process, writing progress, until done', async () => {
    indexDocumentMock
      .mockResolvedValueOnce({
        fileId: 'blob_1',
        chunksWritten: 64,
        chunksTotal: 130,
        partial: true,
      })
      .mockResolvedValueOnce({
        fileId: 'blob_1',
        chunksWritten: 64,
        chunksTotal: 130,
        partial: true,
      })
      .mockResolvedValueOnce({
        fileId: 'blob_1',
        chunksWritten: 2,
        chunksTotal: 130,
        partial: false,
      });
    const { ctx, statusWrites, scheduled } = createCtx();

    await indexFileBlob(ctx, ARGS);

    expect(indexDocumentMock).toHaveBeenCalledTimes(3);
    // The secret scan runs on the first slice only.
    expect(indexDocumentMock.mock.calls[0]?.[0]?.bytes).toBeDefined();
    expect(indexDocumentMock.mock.calls[1]?.[0]?.bytes).toBeUndefined();
    const progress = statusWrites.filter((w) => w.ragProgress !== undefined);
    expect(progress.at(-1)?.ragProgress).toBe('Indexed 128 of 130 chunks');
    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'completed' });
    expect(scheduled).toHaveLength(0);
  });

  it('hands the tail to a rescheduled continuation past the slice budget', async () => {
    indexDocumentMock.mockResolvedValue({
      fileId: 'blob_1',
      chunksWritten: 64,
      chunksTotal: 10_000,
      partial: true,
    });
    const { ctx, statusWrites, scheduled } = createCtx();

    await indexFileBlob(ctx, {
      ...ARGS,
      folderPath: '/reports',
      sourceModifiedAtMs: 1_700_000_000_000,
      documentId: 'doc_1' as never,
    });

    expect(indexDocumentMock).toHaveBeenCalledTimes(20);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.args).toMatchObject({
      organizationId: 'org_1',
      storageId: 'blob_1',
      fileName: 'notes.txt',
      folderPath: '/reports',
      sourceModifiedAtMs: 1_700_000_000_000,
      documentId: 'doc_1',
    });
    // Not terminal: the continuation owns the ending.
    expect(statusWrites.at(-1)).toMatchObject({ ragStatus: 'running' });
  });
});
