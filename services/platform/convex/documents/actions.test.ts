import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock-ctx idiom (see workflow_executions/actions.test.ts): passthrough the
// `action({...})` config so we can call its `handler` directly with a plain
// mock ctx instead of a full convex-test harness (this is a `'use node'`
// action, so convex-test's edge-runtime environment can't load it anyway).
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, action: (config: Record<string, unknown>) => config };
});

vi.mock('../_generated/api', () => ({
  internal: {
    documents: {
      internal_queries: {
        getDocumentByIdRaw: 'getDocumentByIdRaw',
        verifyOrganizationMembership: 'verifyOrganizationMembership',
      },
    },
    file_metadata: {
      internal_queries: { getByStorageId: 'getByStorageId' },
      internal_mutations: {
        ensureFileMetadataForDocument: 'ensureFileMetadataForDocument',
        updateFileRagStatus: 'updateFileRagStatus',
      },
      internal_actions: { pollFileRagStatus: 'pollFileRagStatus' },
    },
  },
}));

vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: vi.fn(async () => ({
    userId: 'user_1',
    email: 'u@x.dev',
    name: 'U',
  })),
}));

const ragExecuteMock = vi.fn();
vi.mock('../workflow_engine/action_defs/rag/rag_action', () => ({
  ragAction: { execute: ragExecuteMock },
}));

// Mock the rate-limiter helpers so the real `rate_limiter/index` →
// `components.rateLimiter` chain never loads (the `../_generated/api` mock
// omits `components`). `mockCheckUserRateLimit` defaults to a no-op; a test
// makes it throw to assert the rate-limited path.
const mockCheckUserRateLimit = vi.fn();
class MockRateLimitExceededError extends Error {
  readonly retryAfter: number;
  constructor(message: string, retryAfter = 1000) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfter = retryAfter;
  }
}
vi.mock('../lib/rate_limiter/helpers', () => ({
  checkUserRateLimit: (...args: unknown[]) => mockCheckUserRateLimit(...args),
  RateLimitExceededError: MockRateLimitExceededError,
}));

const { retryRagIndexing } = await import('./actions');

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };
const handler = (retryRagIndexing as unknown as Handler).handler;

const DOCUMENT = {
  _id: 'doc_1',
  organizationId: 'org_1',
  fileId: 'storage_1',
  title: 'report.xyz',
  mimeType: 'application/x-unknown',
};

/** `retryRagIndexing`'s only result now — the retry dispatch it used to
 * trigger is offline while the platform AI backend is rewritten (see
 * convex/documents/actions.ts), so every guard that still lets an auth'd,
 * member caller reach the end of the handler lands here regardless of the
 * document's RAG status. */
const OFFLINE_RESULT = {
  success: false,
  error:
    'RAG re-indexing is offline while the platform AI backend is rewritten.',
};

function createCtx(opts: {
  document?: unknown;
  isMember?: boolean;
  ragStatus?: string;
  ragQueuedAt?: number;
}) {
  const runMutationCalls: Array<{ ref: unknown; args: unknown }> = [];
  const scheduledCalls: Array<{ ref: unknown; args: unknown }> = [];
  const ctx = {
    runQuery: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      if (ref === 'getDocumentByIdRaw') {
        return opts.document === undefined ? DOCUMENT : opts.document;
      }
      if (ref === 'verifyOrganizationMembership') {
        return opts.isMember ?? true;
      }
      if (ref === 'getByStorageId') {
        return opts.ragStatus === undefined
          ? null
          : {
              storageId: args.storageId,
              ragStatus: opts.ragStatus,
              _creationTime: opts.ragQueuedAt ?? 0,
              ...(opts.ragQueuedAt !== undefined && {
                ragQueuedAt: opts.ragQueuedAt,
              }),
            };
      }
      return null;
    }),
    runMutation: vi.fn(async (ref: unknown, args: unknown) => {
      runMutationCalls.push({ ref, args });
      return null;
    }),
    scheduler: {
      runAfter: vi.fn(async (_delay: number, ref: unknown, args: unknown) => {
        scheduledCalls.push({ ref, args });
        return 'job_1';
      }),
    },
  };
  return { ctx, runMutationCalls, scheduledCalls };
}

describe('retryRagIndexing terminal-status guard (#2598 sibling — now offline)', () => {
  beforeEach(() => {
    ragExecuteMock.mockReset();
  });

  it("returns the offline no-op for a document whose ragStatus is the terminal 'unsupported' — the guard it used to trip is gone with the dispatch", async () => {
    const { ctx, runMutationCalls, scheduledCalls } = createCtx({
      ragStatus: 'unsupported',
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual(OFFLINE_RESULT);
    // Never re-queued, never bounced through 'failed', never re-uploaded.
    expect(ragExecuteMock).not.toHaveBeenCalled();
    expect(runMutationCalls).toHaveLength(0);
    expect(scheduledCalls).toHaveLength(0);
  });

  it('returns the offline no-op regardless of a non-terminal status (e.g. failed) — retry no longer dispatches', async () => {
    const { ctx, runMutationCalls, scheduledCalls } = createCtx({
      ragStatus: 'failed',
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual(OFFLINE_RESULT);
    expect(ragExecuteMock).not.toHaveBeenCalled();
    expect(runMutationCalls).toHaveLength(0);
    expect(scheduledCalls).toHaveLength(0);
  });

  it('returns the offline no-op when there is no fileMetadata row at all', async () => {
    const { ctx } = createCtx({});

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual(OFFLINE_RESULT);
    expect(ragExecuteMock).not.toHaveBeenCalled();
  });
});

describe('retryRagIndexing in-flight + rate-limit guards', () => {
  beforeEach(() => {
    ragExecuteMock.mockReset();
    mockCheckUserRateLimit.mockReset();
  });

  it('returns the offline no-op for a file whose indexing was actively running — the in-flight guard it used to trip is gone with the dispatch', async () => {
    const { ctx, runMutationCalls } = createCtx({
      ragStatus: 'running',
      ragQueuedAt: Date.now(), // fresh → job still alive
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual(OFFLINE_RESULT);
    // No indexing job fired; status untouched.
    expect(ragExecuteMock).not.toHaveBeenCalled();
    expect(runMutationCalls).toHaveLength(0);
  });

  it('returns the offline no-op once the in-flight job is older than the watchdog window too', async () => {
    const { ctx } = createCtx({
      ragStatus: 'running',
      ragQueuedAt: Date.now() - 40 * 60 * 1000, // stale → prior job is dead
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual(OFFLINE_RESULT);
    expect(ragExecuteMock).not.toHaveBeenCalled();
  });

  it('returns the rate-limit message without indexing when throttled', async () => {
    mockCheckUserRateLimit.mockImplementationOnce(() => {
      throw new MockRateLimitExceededError('Rate limit exceeded. Try again.');
    });
    const { ctx } = createCtx({ ragStatus: 'failed' });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate limit/i);
    expect(ragExecuteMock).not.toHaveBeenCalled();
  });
});
