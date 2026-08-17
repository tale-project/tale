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

// The concurrency cap's dispatch/promote helpers query the DB; mock them so
// unit tests of saveFileMetadata / updateFileRagStatus don't need a live index.
// The real logic is covered by rag_dispatch.test.ts.
vi.mock('./rag_dispatch', () => ({
  maybeDispatchRagIndexing: vi.fn(),
  promoteQueuedRagJobs: vi.fn(),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    governance: { retention_cleanup: { runRetentionCleanup: 'mock' } },
    file_metadata: {
      internal_actions: {
        uploadFileToRag: 'mock',
        extractFileMetadata: 'extract_mock',
      },
      transcribe_audio: {
        transcribeAudio: 'transcribeAudio_mock',
      },
    },
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

  it('marks formats the RAG service cannot index as terminal `unsupported` (#2598)', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getSaveHandler();

    await handler(ctx, {
      ...baseArgs,
      fileName: 'legacy.xls',
      contentType: 'application/vnd.ms-excel',
    });

    // Terminal, non-retryable status — never left at `undefined` ("not
    // indexed yet"), which would render as a forever-retryable "Not
    // indexed" for a format that will never index.
    expect(ctx.db.insert).toHaveBeenCalledWith(
      'fileMetadata',
      expect.objectContaining({
        ragStatus: 'unsupported',
        ragQueuedAt: undefined,
      }),
    );
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalledWith(
      0,
      'mock',
      expect.objectContaining({ storageId: 'storage_1' }),
    );
  });

  // Regression: video-link handoff stores audio/mpeg. `resolveFileType`
  // intentionally returns '' for audio MIME, so classifying isAudio from
  // that output skipped Whisper and stamped ragStatus=unsupported — chip
  // stuck on Transcribing….
  it('queues Whisper for audio/mpeg video-link handoff (not unsupported)', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getSaveHandler();

    await handler(ctx, {
      ...baseArgs,
      fileName: 'This Chinese Luxury SUV has so much aura 😌.mp3',
      contentType: 'audio/mpeg',
      size: 3_049_437,
      source: 'video_link',
      uploadedBy: 'user_1',
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      'fileMetadata',
      expect.objectContaining({
        contentType: 'audio/mpeg',
        source: 'video_link',
        transcriptionStatus: 'queued',
        ragStatus: undefined,
      }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'transcribeAudio_mock',
      expect.objectContaining({
        storageId: 'storage_1',
        contentType: 'audio/mpeg',
        organizationId: 'org_1',
      }),
    );
  });

  // The three indexing modes, and the invariant tying them together: a row is
  // only ever left at `'queued'` when its indexing action is dispatched here or
  // by a caller that promised to. `countRagInFlight` charges every unparked
  // `'queued'` row a slot against the per-org cap on trust, so "queued but
  // nobody dispatched" starves the cap permanently — three such rows and
  // nothing indexes for that org again. That is exactly what email attachments
  // did: they wanted "don't index" and reached for the defer flag.
  describe('RAG indexing modes', () => {
    it('by default queues and dispatches immediately', async () => {
      const { ctx } = createMockCtx(null);
      const handler = await getSaveHandler();
      const { maybeDispatchRagIndexing } = await import('./rag_dispatch');

      await handler(ctx, baseArgs);

      expect(ctx.db.insert).toHaveBeenCalledWith(
        'fileMetadata',
        expect.objectContaining({ ragStatus: 'queued' }),
      );
      expect(maybeDispatchRagIndexing).toHaveBeenCalledWith(ctx, 'storage_1');
    });

    it('queues without dispatching when the caller defers (Hub link-then-index)', async () => {
      const { ctx } = createMockCtx(null);
      const handler = await getSaveHandler();
      const { maybeDispatchRagIndexing } = await import('./rag_dispatch');

      await handler(ctx, { ...baseArgs, deferRagDispatch: true });

      // Queued is correct here ONLY because the caller
      // (scheduleHubDocumentRagIndexing) dispatches straight after linking.
      expect(ctx.db.insert).toHaveBeenCalledWith(
        'fileMetadata',
        expect.objectContaining({ ragStatus: 'queued' }),
      );
      expect(maybeDispatchRagIndexing).not.toHaveBeenCalled();
    });

    it('leaves an indexable file unqueued and undispatched when indexing is skipped', async () => {
      const { ctx } = createMockCtx(null);
      const handler = await getSaveHandler();
      const { maybeDispatchRagIndexing } = await import('./rag_dispatch');

      await handler(ctx, { ...baseArgs, skipRagIndexing: true });

      // `undefined`, NOT `'queued'` (would burn a cap slot forever) and NOT
      // `'unsupported'` (a .pdf is indexable — it just isn't being indexed,
      // and `unsupported` is terminal and refuses retry).
      expect(ctx.db.insert).toHaveBeenCalledWith(
        'fileMetadata',
        expect.objectContaining({
          ragStatus: undefined,
          ragQueuedAt: undefined,
        }),
      );
      expect(maybeDispatchRagIndexing).not.toHaveBeenCalled();
    });

    it('does not queue a skipped file on the patch path either', async () => {
      const { ctx } = createMockCtx({
        _id: 'fm_existing',
        organizationId: 'org_1',
        storageId: 'storage_1',
        fileName: 'test.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
      const handler = await getSaveHandler();
      const { maybeDispatchRagIndexing } = await import('./rag_dispatch');

      await handler(ctx, { ...baseArgs, skipRagIndexing: true });

      const patch = (
        ctx.db.patch as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls[0][1] as Record<string, unknown>;
      expect(patch).not.toHaveProperty('ragStatus');
      expect(maybeDispatchRagIndexing).not.toHaveBeenCalled();
    });

    it('still indexes a previously skipped blob when it is saved again for indexing', async () => {
      // Skip is not terminal: `needsRagRetry` accepts an `undefined` status, so
      // the same bytes attached to a Hub document later still index.
      const { ctx } = createMockCtx({
        _id: 'fm_existing',
        organizationId: 'org_1',
        storageId: 'storage_1',
        fileName: 'test.pdf',
        contentType: 'application/pdf',
        size: 1024,
        ragStatus: undefined,
      });
      const handler = await getSaveHandler();
      const { maybeDispatchRagIndexing } = await import('./rag_dispatch');

      await handler(ctx, baseArgs);

      expect(ctx.db.patch).toHaveBeenCalledWith(
        'fm_existing',
        expect.objectContaining({ ragStatus: 'queued' }),
      );
      expect(maybeDispatchRagIndexing).toHaveBeenCalledWith(ctx, 'storage_1');
    });
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

describe('updateFileRagStatus ragError default (empty-failure guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const DEFAULT_FAILURE =
    'Indexing did not finish. Retry to index this document.';

  function failingCtx() {
    // A row mid-flight that is about to be marked failed.
    return createMockCtx({
      _id: 'fm_1',
      storageId: 'storage_1',
      ragStatus: 'running',
      ragQueuedAt: 1,
    });
  }

  // Regression guard: an interrupted indexing action (killed/timed-out job)
  // surfaces an Error with no message, which flowed through as `ragError: ''`
  // and rendered as a bare "Unknown error" with nothing actionable. A failed
  // row must always carry a non-empty, actionable reason instead.
  it('substitutes a non-empty default when ragError is missing on failure', async () => {
    const { ctx } = failingCtx();
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, { storageId: 'storage_1', ragStatus: 'failed' });

    const patchArg = ctx.db.patch.mock.calls[0][1] as { ragError: string };
    expect(patchArg.ragError).toBe(DEFAULT_FAILURE);
    expect(patchArg.ragError).not.toBe('');
    expect(patchArg.ragError.length).toBeGreaterThan(0);
  });

  it('substitutes the default when ragError is an empty string on failure', async () => {
    const { ctx } = failingCtx();
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_1',
      ragStatus: 'failed',
      ragError: '',
    });

    const patchArg = ctx.db.patch.mock.calls[0][1] as { ragError: string };
    expect(patchArg.ragError).toBe(DEFAULT_FAILURE);
  });

  it('substitutes the default when ragError is whitespace-only on failure', async () => {
    const { ctx } = failingCtx();
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_1',
      ragStatus: 'failed',
      ragError: '   ',
    });

    const patchArg = ctx.db.patch.mock.calls[0][1] as { ragError: string };
    expect(patchArg.ragError).toBe(DEFAULT_FAILURE);
  });

  it('preserves a provided non-empty ragError verbatim on failure', async () => {
    const { ctx } = failingCtx();
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_1',
      ragStatus: 'failed',
      ragError: 'OCR engine crashed while parsing page 3',
    });

    const patchArg = ctx.db.patch.mock.calls[0][1] as { ragError: string };
    expect(patchArg.ragError).toBe('OCR engine crashed while parsing page 3');
  });

  it('leaves ragError undefined for a non-failed transition', async () => {
    const { ctx } = failingCtx();
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_1',
      ragStatus: 'completed',
      ragError: 'ignored on success',
    });

    const patchArg = ctx.db.patch.mock.calls[0][1] as {
      ragError: string | undefined;
    };
    expect(patchArg.ragError).toBeUndefined();
  });
});

// `ragErrorCode` lives and dies with `ragError`: only a failed write may carry
// it (it drives the failed dialog's guidance), and every other write — or a
// failed write for a NEW cause without a code — must clear what a previous
// failure left, so stale guidance never pins itself to fresh prose.
describe('updateFileRagStatus ragErrorCode lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function failedRowCtx() {
    // A row that already failed once with a guidable cause.
    return createMockCtx({
      _id: 'fm_1',
      storageId: 'storage_1',
      ragStatus: 'running',
      ragErrorCode: 'embedding_not_configured',
      ragQueuedAt: 1,
    });
  }

  it('persists the code on a failed write that carries one', async () => {
    const { ctx } = failedRowCtx();
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_1',
      ragStatus: 'failed',
      ragError: 'Organization "acme" has no embedding model configured…',
      ragErrorCode: 'embedding_not_configured',
    });

    const patchArg = ctx.db.patch.mock.calls[0][1] as {
      ragErrorCode: string | undefined;
    };
    expect(patchArg.ragErrorCode).toBe('embedding_not_configured');
  });

  it('clears a stale code when a failed write names a new cause without one', async () => {
    const { ctx } = failedRowCtx();
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_1',
      ragStatus: 'failed',
      ragError: 'pool exhausted',
    });

    const patchArg = ctx.db.patch.mock.calls[0][1] as {
      ragErrorCode: string | undefined;
    };
    expect('ragErrorCode' in patchArg).toBe(true);
    expect(patchArg.ragErrorCode).toBeUndefined();
  });

  it('clears the code on a non-failed transition', async () => {
    const { ctx } = failedRowCtx();
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_1',
      ragStatus: 'completed',
      ragErrorCode: 'embedding_not_configured',
    });

    const patchArg = ctx.db.patch.mock.calls[0][1] as {
      ragErrorCode: string | undefined;
    };
    expect(patchArg.ragErrorCode).toBeUndefined();
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

async function getApplyVerifiedBlobSizeHandler() {
  const { applyVerifiedBlobSize } = await import('./internal_mutations');
  return (applyVerifiedBlobSize as unknown as { handler: Function }).handler;
}

describe('applyVerifiedBlobSize (#2731 authoritative S3 upload size)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CAP = 100 * 1024 * 1024;

  it('corrects the stored size within the cap, leaving status untouched', async () => {
    // Client declared 1 KB; the real object is 5 MB (still under the cap).
    const existing = {
      _id: 'fm1',
      storageId: 's3:testorg/uuid',
      size: 1024,
      ragStatus: 'queued',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getApplyVerifiedBlobSizeHandler();

    await handler(ctx, {
      storageId: 's3:testorg/uuid',
      size: 5 * 1024 * 1024,
      overCap: false,
      limitBytes: CAP,
    });

    // usedBytes rides on fileMetadata.size, so it is now honest (5 MB, not 1 KB).
    expect(ctx.db.patch).toHaveBeenCalledWith('fm1', { size: 5 * 1024 * 1024 });
  });

  it('rejects an over-cap object: corrects size AND fails the row', async () => {
    // Client declared 1 KB; the real object is 200 MB (over the 100 MB cap).
    const existing = {
      _id: 'fm1',
      storageId: 's3:testorg/uuid',
      size: 1024,
      ragStatus: 'queued',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getApplyVerifiedBlobSizeHandler();
    const realSize = 200 * 1024 * 1024;

    await handler(ctx, {
      storageId: 's3:testorg/uuid',
      size: realSize,
      overCap: true,
      limitBytes: CAP,
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      'fm1',
      expect.objectContaining({ size: realSize, ragStatus: 'failed' }),
    );
    const patchArg = ctx.db.patch.mock.calls[0][1] as { ragError: string };
    expect(patchArg.ragError).toContain('100 MB limit');
  });

  it('no-ops when the row is already gone', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getApplyVerifiedBlobSizeHandler();

    await handler(ctx, {
      storageId: 's3:testorg/uuid',
      size: 1,
      overCap: false,
      limitBytes: CAP,
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

describe('updateFileRagStatus terminal-success monotonicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A straggling writer (killed sibling dispatcher, dying poll chain) must not
  // pollute a completed index with a late `failed` — success is terminal for a
  // given content; a legitimate re-index passes through `queued` first.
  it('ignores a failed write when the row is already completed', async () => {
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      storageId: 'storage_1',
      ragStatus: 'completed',
    });
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_1',
      ragStatus: 'failed',
      ragError: 'straggler error',
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('still allows a re-queue after completion (content changed)', async () => {
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      storageId: 'storage_1',
      ragStatus: 'completed',
    });
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, { storageId: 'storage_1', ragStatus: 'queued' });

    expect(ctx.db.patch).toHaveBeenCalledTimes(1);
    const patchArg = ctx.db.patch.mock.calls[0][1] as { ragStatus: string };
    expect(patchArg.ragStatus).toBe('queued');
  });
});

describe('updateFileRagStatus document completion CAS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses stale completion after the document moved to a newer file', async () => {
    const { ctx } = createMockCtx(
      {
        _id: 'fm_old',
        storageId: 'storage_old',
        organizationId: 'org_1',
        documentId: 'doc_1',
        ragStatus: 'running',
      },
      {
        _id: 'doc_1',
        organizationId: 'org_1',
        fileId: 'storage_new',
        lifecycleStatus: 'active',
      },
    );
    const handler = await getUpdateRagStatusHandler();

    await handler(ctx, {
      storageId: 'storage_old',
      ragStatus: 'completed',
      expectedDocumentId: 'doc_1',
    });

    expect(ctx.db.patch).toHaveBeenCalledTimes(1);
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'fm_old',
      expect.objectContaining({
        ragStatus: 'failed',
        ragError: 'Indexing stopped because this file was replaced.',
      }),
    );
    expect(ctx.db.patch.mock.calls[0]?.[1]).not.toMatchObject({
      ragStatus: 'completed',
    });
  });
});
