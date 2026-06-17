import { describe, expect, it, vi } from 'vitest';

import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import { uploadFile } from './upload_file_direct';

const FILE_ID = 'doc-abc-123';

/** The serialized shape `internal.rag.documents.upload` resolves to. */
interface RagUploadActionResult {
  success: boolean;
  file_id: string;
  chunks_created: number;
  skipped: boolean;
  skip_reason: string | null;
}

/**
 * `uploadFile` now indexes IN-PROCESS via `ctx.runAction(internal.rag.documents.upload)`
 * (reading bytes from storage by `fileId`) instead of a multipart POST to
 * `RAG_URL`. Per-document metadata is stamped via follow-up `updateMetadata` /
 * `updateFolderPaths` actions. This factory drives the `runAction` spy and
 * returns it for assertion; all other `ActionCtx` members are typed stubs.
 *
 * The spy dispatches by the action reference so a single ctx can resolve the
 * upload + metadata + folder-path calls independently.
 */
function createCtx(uploadResult: RagUploadActionResult): {
  ctx: ActionCtx;
  runAction: ReturnType<typeof vi.fn>;
} {
  // `uploadFile` only reads the upload action's result fields (success /
  // file_id / chunks_created); the updateMetadata / updateFolderPaths return
  // values are ignored, so a single resolved value covers every call. Calls
  // are asserted via `toHaveBeenCalledWith` against the Convex function
  // references (identity `===` on the reference proxy is unreliable).
  const runAction = vi.fn().mockResolvedValue(uploadResult);
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

function defaultArgs() {
  return {
    filename: 'test.txt',
    contentType: 'text/plain',
    fileId: FILE_ID,
    orgSlug: 'default',
  };
}

function okUploadResult(
  overrides?: Partial<RagUploadActionResult>,
): RagUploadActionResult {
  return {
    success: true,
    file_id: 'rag-doc-1',
    chunks_created: 5,
    skipped: false,
    skip_reason: null,
    ...overrides,
  };
}

describe('uploadFile', () => {
  it('indexes via the in-process upload action with storageId = fileId', async () => {
    const { ctx, runAction } = createCtx(okUploadResult());

    await uploadFile(ctx, defaultArgs());

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.upload, {
      orgSlug: 'default',
      fileId: FILE_ID,
      filename: 'test.txt',
      storageId: FILE_ID,
      // No inline content → indexer reads bytes from storage by storageId.
      content: null,
    });
  });

  it('passes inline base64 content (and null storageId) when content is supplied', async () => {
    const { ctx, runAction } = createCtx(okUploadResult());

    await uploadFile(ctx, {
      ...defaultArgs(),
      content: new Blob(['transcript text'], { type: 'text/plain' }),
    });

    expect(runAction).toHaveBeenCalledWith(
      internal.rag.documents.upload,
      expect.objectContaining({
        orgSlug: 'default',
        fileId: FILE_ID,
        filename: 'test.txt',
        storageId: null,
        content: expect.any(String),
      }),
    );
  });

  it('stamps filterable metadata via updateMetadata (dropping content_type)', async () => {
    const { ctx, runAction } = createCtx(okUploadResult());

    await uploadFile(ctx, {
      ...defaultArgs(),
      metadata: { team_id: 'team-1', content_type: 'text/plain' },
    });

    expect(runAction).toHaveBeenCalledWith(
      internal.rag.documents.updateMetadata,
      {
        orgSlug: 'default',
        updates: [{ file_id: FILE_ID, metadata: { team_id: 'team-1' } }],
      },
    );
  });

  it('routes the folder_path metadata key to updateFolderPaths', async () => {
    const { ctx, runAction } = createCtx(okUploadResult());

    await uploadFile(ctx, {
      ...defaultArgs(),
      metadata: { folder_path: 'legal/contracts' },
    });

    expect(runAction).toHaveBeenCalledWith(
      internal.rag.documents.updateFolderPaths,
      {
        orgSlug: 'default',
        updates: [{ file_id: FILE_ID, folder_path: 'legal/contracts' }],
      },
    );
  });

  it('does not call updateMetadata when no metadata is supplied', async () => {
    const { ctx, runAction } = createCtx(okUploadResult());

    await uploadFile(ctx, defaultArgs());

    // With no metadata, the only runAction call is the upload itself — no
    // follow-up updateMetadata / updateFolderPaths. (Asserting via call count
    // avoids identity-comparing the Convex function-reference proxy, whose
    // pretty-printer throws on `===` diffs.)
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it('returns the RagUploadResult shape on success', async () => {
    const { ctx } = createCtx(
      okUploadResult({ file_id: 'rag-doc-42', chunks_created: 7 }),
    );

    const result = await uploadFile(ctx, defaultArgs());

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        fileId: FILE_ID,
        ragDocumentId: 'rag-doc-42',
        chunksCreated: 7,
      }),
    );
    expect(result.processingTimeMs).toBeTypeOf('number');
    expect(result.timestamp).toBeTypeOf('number');
  });

  it('defaults chunksCreated to 0 when the action returns 0', async () => {
    const { ctx } = createCtx(okUploadResult({ chunks_created: 0 }));

    const result = await uploadFile(ctx, defaultArgs());

    expect(result.chunksCreated).toBe(0);
  });

  it('propagates the action success flag', async () => {
    const { ctx } = createCtx(okUploadResult({ success: false }));

    const result = await uploadFile(ctx, defaultArgs());

    expect(result.success).toBe(false);
  });
});
