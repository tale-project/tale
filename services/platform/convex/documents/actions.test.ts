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
          : { storageId: args.storageId, ragStatus: opts.ragStatus };
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

describe('retryRagIndexing terminal-status guard (#2598 sibling)', () => {
  beforeEach(() => {
    ragExecuteMock.mockReset();
  });

  it("refuses to retry a document whose ragStatus is the terminal 'unsupported'", async () => {
    const { ctx, runMutationCalls, scheduledCalls } = createCtx({
      ragStatus: 'unsupported',
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no text extractor/i);
    // Never re-queued, never bounced through 'failed', never re-uploaded.
    expect(ragExecuteMock).not.toHaveBeenCalled();
    expect(runMutationCalls).toHaveLength(0);
    expect(scheduledCalls).toHaveLength(0);
  });

  it('retries normally when the status is a non-terminal one (e.g. failed)', async () => {
    ragExecuteMock.mockResolvedValueOnce({ success: true });
    const { ctx, runMutationCalls, scheduledCalls } = createCtx({
      ragStatus: 'failed',
    });

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result.success).toBe(true);
    expect(ragExecuteMock).toHaveBeenCalledTimes(1);
    expect(runMutationCalls).toContainEqual(
      expect.objectContaining({ ref: 'updateFileRagStatus' }),
    );
    expect(scheduledCalls).toContainEqual(
      expect.objectContaining({ ref: 'pollFileRagStatus' }),
    );
  });

  it('retries normally when there is no fileMetadata row at all', async () => {
    ragExecuteMock.mockResolvedValueOnce({ success: true });
    const { ctx } = createCtx({});

    const result = await handler(ctx, { documentId: 'doc_1' });

    expect(result.success).toBe(true);
    expect(ragExecuteMock).toHaveBeenCalledTimes(1);
  });
});
