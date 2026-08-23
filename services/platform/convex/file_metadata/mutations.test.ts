import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkUploadPolicy } from '../governance/upload_enforcement';

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
    ConvexError: class ConvexError extends Error {
      data: unknown;
      constructor(data: unknown) {
        super(typeof data === 'string' ? data : 'ConvexError');
        this.data = data;
      }
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkOrganizationRateLimit: vi.fn(),
  RateLimitExceededError: class extends Error {},
}));

// The per-org concurrency cap: saveFileMetadata now delegates RAG scheduling to
// maybeDispatchRagIndexing (which queries the DB to count in-flight jobs). Mock
// it here and assert delegation; the real dispatch/promote logic is covered by
// rag_dispatch.test.ts.
const mockMaybeDispatchRagIndexing = vi.fn();
vi.mock('./rag_dispatch', () => ({
  maybeDispatchRagIndexing: (...args: unknown[]) =>
    mockMaybeDispatchRagIndexing(...args),
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
      internal_mutations: {
        updateFileTranscription: 'updateFileTranscription_mock',
      },
      transcribe_audio: {
        transcribeAudio: 'transcribeAudio_mock',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('../governance/upload_enforcement', () => ({
  checkUploadPolicy: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Org-membership gate (#2039). By default every test runs as a valid member;
// the authorization tests override this to reject (non-member).
const mockGetOrganizationMember = vi.fn();
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

const VALID_MEMBER = {
  _id: 'member_1',
  organizationId: 'org_1',
  userId: 'user_1',
  role: 'member',
};

function createMockCtx(existingDoc: Record<string, unknown> | null = null) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(existingDoc),
    // The thread-org cross-check (`threadMetadata` lookup) resolves via
    // `.unique()`; default to no matching thread so the gate is a no-op.
    unique: vi.fn().mockResolvedValue(null),
  };

  const ctx = {
    auth: {
      getUserIdentity: vi.fn(async () => {
        const u = await mockGetAuthUser();
        return u ? { subject: u._id, email: u.email, name: u.name } : null;
      }),
    },
    db: {
      query: vi.fn().mockReturnValue(builder),
      insert: vi.fn().mockResolvedValue('fm_new'),
      patch: vi.fn().mockResolvedValue(undefined),
    },
    runMutation: vi.fn().mockResolvedValue(undefined),
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { ctx, builder };
}

async function getHandler() {
  const { saveFileMetadata } = await import('./mutations');
  return (saveFileMetadata as unknown as { handler: Function }).handler;
}

async function getSkipHandler() {
  const { skipTranscription } = await import('./mutations');
  return (skipTranscription as unknown as { handler: Function }).handler;
}

async function getRetryHandler() {
  const { retryTranscription } = await import('./mutations');
  return (retryTranscription as unknown as { handler: Function }).handler;
}

const baseArgs = {
  organizationId: 'org_1',
  storageId: 'storage_1',
  fileName: 'test.pdf',
  contentType: 'application/pdf',
  size: 1024,
};

const AUTH_USER = {
  _id: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
};

describe('saveFileMetadata (public)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrganizationMember.mockResolvedValue(VALID_MEMBER);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, baseArgs)).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED' },
    });
  });

  it('rejects callers who are not a member of the target org', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    // Caller holds a valid JWT but is not a member of org_1 — the gate
    // must throw before any fileMetadata row is written or RAG is queued.
    mockGetOrganizationMember.mockRejectedValue(
      new Error('Not a member of organization org_1'),
    );
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await expect(handler(ctx, baseArgs)).rejects.toThrow(
      'Not a member of organization org_1',
    );
    expect(mockGetOrganizationMember).toHaveBeenCalledWith(
      ctx,
      'org_1',
      expect.objectContaining({ userId: 'user_1' }),
    );
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('rejects uploads blocked by organization policy, preserving the reason', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    vi.mocked(checkUploadPolicy).mockResolvedValueOnce({
      allowed: false,
      reason: 'File type not permitted',
    });
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await expect(handler(ctx, baseArgs)).rejects.toMatchObject({
      data: { code: 'UPLOAD_REJECTED', reason: 'File type not permitted' },
    });
    // The rejection happens before any DB write.
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('falls back to a generic reason when the policy omits one', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    vi.mocked(checkUploadPolicy).mockResolvedValueOnce({ allowed: false });
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await expect(handler(ctx, baseArgs)).rejects.toMatchObject({
      data: {
        code: 'UPLOAD_REJECTED',
        reason: 'Upload rejected by organization policy',
      },
    });
  });

  it('rejects a threadId that belongs to a different organization', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    // The threadMetadata lookup resolves a row owned by another org; the
    // fileMetadata insert/query path is never reached.
    const { ctx, builder } = createMockCtx(null);
    builder.unique.mockResolvedValueOnce({
      threadId: 'thread_1',
      organizationId: 'org_other',
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { ...baseArgs, threadId: 'thread_1' }),
    ).rejects.toMatchObject({ data: { code: 'THREAD_ORG_MISMATCH' } });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('inserts new file metadata when none exists', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

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
      uploadedBy: 'user_1',
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('skips RAG indexing when skipRagIndexing is set (external agent), persisting the opt-out', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    // An indexable PDF that would normally queue RAG — the external-agent
    // composer opts out so the file is staged to the sandbox, not the KB.
    await handler(ctx, { ...baseArgs, skipRagIndexing: true });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      'fileMetadata',
      expect.objectContaining({
        ragStatus: undefined,
        ragQueuedAt: undefined,
        skipRagIndexing: true,
      }),
    );
    expect(mockMaybeDispatchRagIndexing).not.toHaveBeenCalled();
  });

  it('keeps a persisted opt-out sticky: a re-save WITHOUT the flag neither clears it nor queues', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      ragStatus: undefined,
      skipRagIndexing: true,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    const patch = (ctx.db.patch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('ragStatus');
    expect(patch).not.toHaveProperty('skipRagIndexing');
    expect(mockMaybeDispatchRagIndexing).not.toHaveBeenCalled();
  });

  it('patches existing file metadata by storageId', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    const result = await handler(ctx, {
      ...baseArgs,
      fileName: 'new.pdf',
      size: 2048,
    });

    expect(result).toBe('fm_existing');
    // Existing row had no ragStatus, so the retry-on-reuse logic kicks in:
    // reset status + stamp queuedAt + reschedule uploadFileToRag.
    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'new.pdf',
      contentType: 'application/pdf',
      size: 2048,
      uploadedBy: 'user_1',
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('does not reschedule RAG when existing row already completed', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
      ragStatus: 'completed',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user_1',
    });
    expect(mockMaybeDispatchRagIndexing).not.toHaveBeenCalled();
  });

  it('reschedules RAG when existing row previously failed', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
      ragStatus: 'failed',
      ragError: 'old error',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user_1',
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
    expect(mockMaybeDispatchRagIndexing).toHaveBeenCalledWith(ctx, 'storage_1');
  });

  it('does not queue RAG for formats the RAG service cannot index', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, {
      ...baseArgs,
      fileName: 'legacy.doc',
      contentType: 'application/msword',
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      'fileMetadata',
      expect.objectContaining({
        ragStatus: undefined,
        ragQueuedAt: undefined,
      }),
    );
    expect(mockMaybeDispatchRagIndexing).not.toHaveBeenCalled();
  });

  it('does not queue RAG for extension-less files with unknown MIME', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, {
      ...baseArgs,
      fileName: 'README',
      contentType: 'application/octet-stream',
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      'fileMetadata',
      expect.objectContaining({ ragStatus: undefined }),
    );
    expect(mockMaybeDispatchRagIndexing).not.toHaveBeenCalled();
  });

  it.each([
    [
      'report.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    [
      'sheet.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  ])('queues RAG for indexable office format %s', async (fileName, mime) => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, { ...baseArgs, fileName, contentType: mime });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      'fileMetadata',
      expect.objectContaining({
        ragStatus: 'queued',
        ragQueuedAt: expect.any(Number),
      }),
    );
    expect(mockMaybeDispatchRagIndexing).toHaveBeenCalledWith(ctx, 'storage_1');
  });

  it('clears stale failed RAG state on non-indexable re-upload without re-queueing', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'legacy.doc',
      contentType: 'application/msword',
      size: 512,
      ragStatus: 'failed',
      ragError: 'RAG /api/v1/documents/upload returned HTTP 400.',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    await handler(ctx, {
      ...baseArgs,
      fileName: 'legacy.doc',
      contentType: 'application/msword',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'legacy.doc',
      contentType: 'application/msword',
      size: 1024,
      uploadedBy: 'user_1',
      ragStatus: undefined,
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: undefined,
    });
    expect(mockMaybeDispatchRagIndexing).not.toHaveBeenCalled();
  });

  it('queries by storageId index', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx, builder } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.query).toHaveBeenCalledWith('fileMetadata');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_storageId',
      expect.any(Function),
    );
  });

  it('includes documentId on insert when provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, { ...baseArgs, documentId: 'doc_1' });

    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user_1',
      documentId: 'doc_1',
      ragStatus: 'queued',
      ragQueuedAt: expect.any(Number),
    });
  });

  it('does not clear existing documentId when not provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
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
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    // Existing row has no ragStatus, so retry-on-reuse kicks in (same
    // as "patches existing" case); documentId must not be cleared.
    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user_1',
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
  });
});

const skipArgs = { storageId: 'storage_1', organizationId: 'org_1' };

describe('skipTranscription (public)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrganizationMember.mockResolvedValue(VALID_MEMBER);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    const handler = await getSkipHandler();

    await expect(handler(ctx, skipArgs)).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED' },
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('throws FILE_NOT_FOUND when no row matches the storageId', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getSkipHandler();

    await expect(handler(ctx, skipArgs)).rejects.toMatchObject({
      data: { code: 'FILE_NOT_FOUND' },
    });
  });

  it('rejects callers who are not a member of the file org', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockGetOrganizationMember.mockRejectedValue(
      new Error('Not a member of organization org_1'),
    );
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_1',
      transcriptionStatus: 'running',
    });
    const handler = await getSkipHandler();

    await expect(handler(ctx, skipArgs)).rejects.toThrow(
      'Not a member of organization org_1',
    );
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('throws NOT_AUTHORIZED when the row belongs to another org', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_other',
      transcriptionStatus: 'running',
    });
    const handler = await getSkipHandler();

    await expect(handler(ctx, skipArgs)).rejects.toMatchObject({
      data: { code: 'NOT_AUTHORIZED' },
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('throws TRANSCRIPTION_NOT_SKIPPABLE with the current status for a non-skippable row', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_1',
      transcriptionStatus: 'completed',
    });
    const handler = await getSkipHandler();

    await expect(handler(ctx, skipArgs)).rejects.toMatchObject({
      data: { code: 'TRANSCRIPTION_NOT_SKIPPABLE', status: 'completed' },
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('reports status "none" when the row has no transcriptionStatus', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_1',
    });
    const handler = await getSkipHandler();

    await expect(handler(ctx, skipArgs)).rejects.toMatchObject({
      data: { code: 'TRANSCRIPTION_NOT_SKIPPABLE', status: 'none' },
    });
  });

  it('marks a running transcription as skipped via updateFileTranscription', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_1',
      transcriptionStatus: 'running',
    });
    const handler = await getSkipHandler();

    await handler(ctx, skipArgs);

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'updateFileTranscription_mock',
      {
        storageId: 'storage_1',
        transcriptionStatus: 'skipped',
        transcriptionError: 'User skipped transcription',
      },
    );
  });
});

const retryArgs = { storageId: 'storage_1', organizationId: 'org_1' };

describe('retryTranscription (public)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrganizationMember.mockResolvedValue(VALID_MEMBER);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    const handler = await getRetryHandler();

    await expect(handler(ctx, retryArgs)).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED' },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('throws FILE_NOT_FOUND when no row matches the storageId', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getRetryHandler();

    await expect(handler(ctx, retryArgs)).rejects.toMatchObject({
      data: { code: 'FILE_NOT_FOUND' },
    });
  });

  it('rejects callers who are not a member of the file org', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockGetOrganizationMember.mockRejectedValue(
      new Error('Not a member of organization org_1'),
    );
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_1',
      transcriptionStatus: 'failed',
    });
    const handler = await getRetryHandler();

    await expect(handler(ctx, retryArgs)).rejects.toThrow(
      'Not a member of organization org_1',
    );
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('throws NOT_AUTHORIZED when the row belongs to another org', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_other',
      transcriptionStatus: 'failed',
    });
    const handler = await getRetryHandler();

    await expect(handler(ctx, retryArgs)).rejects.toMatchObject({
      data: { code: 'NOT_AUTHORIZED' },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('throws TRANSCRIPTION_NOT_RETRYABLE with the current status for a non-retryable row', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_1',
      transcriptionStatus: 'running',
    });
    const handler = await getRetryHandler();

    await expect(handler(ctx, retryArgs)).rejects.toMatchObject({
      data: { code: 'TRANSCRIPTION_NOT_RETRYABLE', status: 'running' },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('reports status "none" when the row has no transcriptionStatus', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_1',
    });
    const handler = await getRetryHandler();

    await expect(handler(ctx, retryArgs)).rejects.toMatchObject({
      data: { code: 'TRANSCRIPTION_NOT_RETRYABLE', status: 'none' },
    });
  });

  it('re-queues a failed transcription and reschedules the action', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx({
      _id: 'fm_1',
      organizationId: 'org_1',
      fileName: 'clip.mp3',
      contentType: 'audio/mpeg',
      transcriptionStatus: 'failed',
    });
    const handler = await getRetryHandler();

    await handler(ctx, retryArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_1', {
      transcriptionStatus: 'queued',
      transcriptionError: undefined,
      transcriptionRunId: undefined,
      transcriptionLeaseExpiresAt: undefined,
    });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'transcribeAudio_mock',
      expect.objectContaining({
        storageId: 'storage_1',
        organizationId: 'org_1',
      }),
    );
  });
});
