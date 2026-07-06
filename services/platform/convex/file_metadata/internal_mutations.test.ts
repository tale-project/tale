import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      id: stub,
      object: stub,
      union: stub,
      literal: stub,
      array: stub,
      null: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkOrganizationRateLimit: vi.fn(),
  RateLimitExceededError: class extends Error {},
}));

vi.mock('../_generated/api', () => ({
  internal: {
    governance: { retention_cleanup: { runRetentionCleanup: 'mock' } },
    file_metadata: { internal_actions: { uploadFileToRag: 'mock' } },
  },
}));

function createMockCtx(
  existingDoc: Record<string, unknown> | null = null,
  linkedDoc: Record<string, unknown> | null = null,
  systemMeta: Record<string, unknown> | null = null,
) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(existingDoc),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
      get: vi.fn().mockResolvedValue(linkedDoc),
      insert: vi.fn().mockResolvedValue('fm_new'),
      patch: vi.fn().mockResolvedValue(undefined),
      system: {
        get: vi.fn().mockResolvedValue(systemMeta),
      },
    },
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { ctx, builder };
}

async function getSaveHandler() {
  const { saveFileMetadata } = await import('./internal_mutations');
  return (saveFileMetadata as unknown as { handler: Function }).handler;
}

async function getLinkHandler() {
  const { linkDocumentToFile } = await import('./internal_mutations');
  return (linkDocumentToFile as unknown as { handler: Function }).handler;
}

async function getUpdateRagStatusHandler() {
  const { updateFileRagStatus } = await import('./internal_mutations');
  return (updateFileRagStatus as unknown as { handler: Function }).handler;
}

async function getEnsureHandler() {
  const { ensureFileMetadataForDocument } =
    await import('./internal_mutations');
  return (ensureFileMetadataForDocument as unknown as { handler: Function })
    .handler;
}

const baseArgs = {
  organizationId: 'org_1',
  storageId: 'storage_1',
  fileName: 'test.pdf',
  contentType: 'application/pdf',
  size: 1024,
};

describe('saveFileMetadata (internal)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts new file metadata when none exists', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getSaveHandler();

    const result = await handler(ctx, baseArgs);

    expect(result).toBe('fm_new');
    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      ragStatus: 'queued',
      ragQueuedAt: expect.any(Number),
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('patches existing file metadata by storageId', async () => {
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getSaveHandler();

    const result = await handler(ctx, {
      ...baseArgs,
      fileName: 'updated.pdf',
      size: 2048,
    });

    expect(result).toBe('fm_existing');
    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'updated.pdf',
      contentType: 'application/pdf',
      size: 2048,
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('does not queue RAG for formats the RAG service cannot index', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getSaveHandler();

    await handler(ctx, {
      ...baseArgs,
      fileName: 'legacy.xls',
      contentType: 'application/vnd.ms-excel',
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      'fileMetadata',
      expect.objectContaining({
        ragStatus: undefined,
        ragQueuedAt: undefined,
      }),
    );
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalledWith(
      0,
      'mock',
      expect.objectContaining({ storageId: 'storage_1' }),
    );
  });

  it('queries by storageId index', async () => {
    const { ctx, builder } = createMockCtx(null);
    const handler = await getSaveHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.query).toHaveBeenCalledWith('fileMetadata');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_storageId',
      expect.any(Function),
    );
  });

  it('includes documentId on insert when provided', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getSaveHandler();

    await handler(ctx, { ...baseArgs, documentId: 'doc_1' });

    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      documentId: 'doc_1',
      ragStatus: 'queued',
      ragQueuedAt: expect.any(Number),
    });
  });

  it('includes documentId on patch when provided', async () => {
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getSaveHandler();

    await handler(ctx, { ...baseArgs, documentId: 'doc_1' });

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      documentId: 'doc_1',
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
  });

  it('does not clear existing documentId when not provided', async () => {
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      documentId: 'doc_existing',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getSaveHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
  });
});

describe('linkDocumentToFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('patches metadata with documentId when found', async () => {
    const existing = {
      _id: 'fm_existing',
      storageId: 'storage_1',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getLinkHandler();

    await handler(ctx, { storageId: 'storage_1', documentId: 'doc_1' });

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      documentId: 'doc_1',
    });
  });

  it('is a no-op when metadata not found', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getLinkHandler();

    await handler(ctx, { storageId: 'storage_1', documentId: 'doc_1' });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("records the linked document's connector provider as source", async () => {
    const { ctx } = createMockCtx(
      { _id: 'fm_existing', storageId: 'storage_1' },
      { sourceProvider: 'confluence' },
    );
    const handler = await getLinkHandler();

    await handler(ctx, { storageId: 'storage_1', documentId: 'doc_1' });

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      documentId: 'doc_1',
      source: 'confluence',
    });
  });

  it("maps an 'upload' document provider to source 'user'", async () => {
    const { ctx } = createMockCtx(
      { _id: 'fm_existing', storageId: 'storage_1' },
      { sourceProvider: 'upload' },
    );
    const handler = await getLinkHandler();

    await handler(ctx, { storageId: 'storage_1', documentId: 'doc_1' });

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      documentId: 'doc_1',
      source: 'user',
    });
  });
});

describe('updateFileRagStatus ragIndexedAt units', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression guard: the completion timestamp must be Unix SECONDS, not ms.
  // The RagStatusBadge renders `new Date(indexedAt * 1000)`, and both the
  // legacy ragInfo.indexedAt writer and the backfill store seconds — writing
  // Date.now() (ms) here renders a ~year-58000 date.
  it('stamps ragIndexedAt in SECONDS on completion (not ms)', async () => {
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      storageId: 'storage_1',
      ragStatus: 'running',
      ragQueuedAt: 1,
    });
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, { storageId: 'storage_1', ragStatus: 'completed' });

    const patchArg = ctx.db.patch.mock.calls[0][1] as { ragIndexedAt: number };
    const nowSeconds = Math.floor(Date.now() / 1000);
    // In seconds range (~1.7e9), decisively below the ms range (~1.7e12).
    expect(patchArg.ragIndexedAt).toBeGreaterThan(1_000_000_000);
    expect(patchArg.ragIndexedAt).toBeLessThan(100_000_000_000);
    expect(Math.abs(patchArg.ragIndexedAt - nowSeconds)).toBeLessThanOrEqual(5);
  });

  it('preserves prior ragIndexedAt for non-completed transitions', async () => {
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      storageId: 'storage_1',
      ragStatus: 'queued',
      ragIndexedAt: 1_700_000_000,
    });
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, { storageId: 'storage_1', ragStatus: 'running' });

    const patchArg = ctx.db.patch.mock.calls[0][1] as { ragIndexedAt: number };
    expect(patchArg.ragIndexedAt).toBe(1_700_000_000);
  });
});

describe('ensureFileMetadataForDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ensureArgs = {
    organizationId: 'org_1',
    storageId: 'storage_1',
    documentId: 'doc_1',
    fileName: 'test.pdf',
    contentType: 'application/pdf',
  };

  it('creates a minimal linked row when none exists, reading size/contentType from the storage system table', async () => {
    const { ctx } = createMockCtx(null, null, {
      size: 2048,
      contentType: 'application/pdf',
    });
    const handler = await getEnsureHandler();

    const result = await handler(ctx, {
      ...ensureArgs,
      contentType: undefined,
    });

    expect(result).toBe('fm_new');
    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      documentId: 'doc_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 2048,
    });
    // Must NOT schedule another RAG upload/poll — the caller already uploaded.
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('defaults contentType/size when the blob has no system metadata', async () => {
    const { ctx } = createMockCtx(null, null, null);
    const handler = await getEnsureHandler();

    await handler(ctx, { ...ensureArgs, contentType: undefined });

    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      documentId: 'doc_1',
      fileName: 'test.pdf',
      contentType: 'application/octet-stream',
      size: 0,
    });
  });

  it('links documentId on an existing-but-unlinked row without inserting', async () => {
    const { ctx } = createMockCtx({
      _id: 'fm_existing',
      storageId: 'storage_1',
    });
    const handler = await getEnsureHandler();

    const result = await handler(ctx, ensureArgs);

    expect(result).toBe('fm_existing');
    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      documentId: 'doc_1',
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('is a no-op when the row already has a documentId', async () => {
    const { ctx } = createMockCtx({
      _id: 'fm_existing',
      storageId: 'storage_1',
      documentId: 'doc_existing',
    });
    const handler = await getEnsureHandler();

    const result = await handler(ctx, ensureArgs);

    expect(result).toBe('fm_existing');
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});
