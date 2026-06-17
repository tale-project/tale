import { describe, it, expect, vi } from 'vitest';

import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import { deleteDocumentById } from './delete_document';

/** The serialized shape `internal.rag.documents.deleteDocument` resolves to. */
interface RagDeleteActionResult {
  success: boolean;
  message: string;
  deleted_count: number;
  deleted_data_ids: string[];
  processing_time_ms: number;
}

/**
 * `deleteDocumentById` now delegates the actual delete to an in-process
 * `ctx.runAction(internal.rag.documents.deleteDocument)` instead of
 * `globalThis.fetch`/`RAG_URL`. This test exercises that contract: the
 * `runAction` spy resolves to (or rejects with) the action's result, and is
 * returned for assertion. All other `ActionCtx` members are typed stubs the
 * helper never invokes.
 */
function createCtx(options: {
  result?: RagDeleteActionResult;
  reject?: Error;
}): { ctx: ActionCtx; runAction: ReturnType<typeof vi.fn> } {
  const runAction = vi.fn();
  if (options.reject) {
    runAction.mockRejectedValue(options.reject);
  } else {
    runAction.mockResolvedValue(options.result);
  }
  const ctx: ActionCtx = {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    runAction,
    scheduler: { runAfter: vi.fn(), runAt: vi.fn(), cancel: vi.fn() },
    auth: { getUserIdentity: vi.fn() },
    storage: {
      generateUploadUrl: vi.fn(),
      getUrl: vi.fn(),
      getMetadata: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      store: vi.fn(),
    },
    vectorSearch: vi.fn(),
  };
  return { ctx, runAction };
}

describe('deleteDocumentById', () => {
  it('calls the in-process delete action with orgSlug + fileId', async () => {
    const { ctx, runAction } = createCtx({
      result: {
        success: true,
        deleted_count: 1,
        deleted_data_ids: ['abc'],
        message: 'Deleted',
        processing_time_ms: 5,
      },
    });

    await deleteDocumentById(ctx, { orgSlug: 'test-org', fileId: 'doc-123' });

    expect(runAction).toHaveBeenCalledWith(
      internal.rag.documents.deleteDocument,
      { orgSlug: 'test-org', fileId: 'doc-123' },
    );
  });

  it('returns parsed result on success', async () => {
    const { ctx } = createCtx({
      result: {
        success: true,
        deleted_count: 2,
        deleted_data_ids: ['id1', 'id2'],
        message: 'Deleted 2 docs',
        processing_time_ms: 42,
      },
    });

    const result = await deleteDocumentById(ctx, {
      orgSlug: 'test-org',
      fileId: 'doc-abc',
    });

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2);
    expect(result.deletedDataIds).toEqual(['id1', 'id2']);
    expect(result.message).toBe('Deleted 2 docs');
  });

  it('treats a not-found document as a successful no-op (idempotent)', async () => {
    // The in-process delete returns success with deleted_count 0 for a missing
    // document (no 404 to special-case) — retention/cascade purges stay safe to
    // repeat.
    const { ctx } = createCtx({
      result: {
        success: true,
        deleted_count: 0,
        deleted_data_ids: [],
        message: "No documents found with ID 'doc-already-gone'",
        processing_time_ms: 3,
      },
    });

    const result = await deleteDocumentById(ctx, {
      orgSlug: 'test-org',
      fileId: 'doc-already-gone',
    });

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('folds a thrown action error into a structured failure result', async () => {
    const { ctx } = createCtx({
      reject: new Error('knowledge-db unavailable'),
    });

    const result = await deleteDocumentById(ctx, {
      orgSlug: 'test-org',
      fileId: 'doc-fail',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/knowledge-db unavailable/);
    expect(result.deletedCount).toBe(0);
  });

  it('forwards the raw fileId untouched (no URL encoding)', async () => {
    const { ctx, runAction } = createCtx({
      result: {
        success: true,
        deleted_count: 0,
        deleted_data_ids: [],
        message: 'ok',
        processing_time_ms: 1,
      },
    });

    await deleteDocumentById(ctx, {
      orgSlug: 'test-org',
      fileId: 'doc/with spaces',
    });

    expect(runAction).toHaveBeenCalledWith(
      internal.rag.documents.deleteDocument,
      { orgSlug: 'test-org', fileId: 'doc/with spaces' },
    );
  });
});
