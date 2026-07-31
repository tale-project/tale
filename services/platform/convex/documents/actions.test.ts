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
        requeueFileForRagIndexing: 'requeueFileForRagIndexing',
      },
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

function createCtx(opts: {
  document?: unknown;
  isMember?: boolean;
  ragStatus?: string;
  ragError?: string;
  ragQueuedAt?: number;
}) {
  const runMutationCalls: Array<{ ref: unknown; args: unknown }> = [];
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
              ...(opts.ragError !== undefined && { ragError: opts.ragError }),
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
  };
  return { ctx, runMutationCalls };
}

describe('retryRagIndexing terminal-status guard (#2598 sibling)', () => {
  beforeEach(() => {
    mockCheckUserRateLimit.mockReset();
  });

  it("refuses a document whose ragStatus is the terminal 'unsupported' — a retry can only reproduce the rejection", async () => {
    const { ctx, runMutationCalls } = createCtx({
      ragStatus: 'unsupported',
      ragError: 'No text extractor exists for ".xyz" files.',
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No text extractor/);
    // Never re-queued, never bounced through 'failed'.
    expect(runMutationCalls).toHaveLength(0);
  });

  it('re-queues a failed document through the ensure + requeue pair', async () => {
    const { ctx, runMutationCalls } = createCtx({ ragStatus: 'failed' });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual({ success: true });
    expect(runMutationCalls.map((c) => c.ref)).toEqual([
      'ensureFileMetadataForDocument',
      'requeueFileForRagIndexing',
    ]);
    expect(runMutationCalls[1]?.args).toEqual({ storageId: 'storage_1' });
  });

  it('re-queues when there is no fileMetadata row at all — ensure self-heals the status home', async () => {
    const { ctx, runMutationCalls } = createCtx({});

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual({ success: true });
    expect(runMutationCalls.map((c) => c.ref)).toEqual([
      'ensureFileMetadataForDocument',
      'requeueFileForRagIndexing',
    ]);
  });
});

describe('retryRagIndexing in-flight + rate-limit guards', () => {
  beforeEach(() => {
    mockCheckUserRateLimit.mockReset();
  });

  it('refuses while a fresh indexing job is still in flight — a retry now would double-index', async () => {
    const { ctx, runMutationCalls } = createCtx({
      ragStatus: 'running',
      ragQueuedAt: Date.now(), // fresh → job still alive
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already in progress/i);
    expect(runMutationCalls).toHaveLength(0);
  });

  it('re-queues once the in-flight job is older than the watchdog window — the prior job is dead', async () => {
    const { ctx, runMutationCalls } = createCtx({
      ragStatus: 'running',
      ragQueuedAt: Date.now() - 40 * 60 * 1000, // stale → prior job is dead
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual({ success: true });
    expect(runMutationCalls.map((c) => c.ref)).toEqual([
      'ensureFileMetadataForDocument',
      'requeueFileForRagIndexing',
    ]);
  });

  it('returns the rate-limit message without re-queueing when throttled', async () => {
    mockCheckUserRateLimit.mockImplementationOnce(() => {
      throw new MockRateLimitExceededError('Rate limit exceeded. Try again.');
    });
    const { ctx, runMutationCalls } = createCtx({ ragStatus: 'failed' });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate limit/i);
    expect(runMutationCalls).toHaveLength(0);
  });

  it('refuses a document with no file to index', async () => {
    const { ctx, runMutationCalls } = createCtx({
      document: { ...DOCUMENT, fileId: undefined },
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual({ success: false, error: 'Document has no file' });
    expect(runMutationCalls).toHaveLength(0);
  });

  it('refuses a caller who is not a member of the owning organization', async () => {
    const { ctx, runMutationCalls } = createCtx({ isMember: false });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(runMutationCalls).toHaveLength(0);
  });
});
