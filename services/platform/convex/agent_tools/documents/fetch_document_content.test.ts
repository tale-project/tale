import { beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { fetchDocumentContent } from './helpers/fetch_document_content';

const FILE_ID = 'file-storage-123';
const ORG_SLUG = 'test-org';

/** The serialized shape `internal.rag.documents.getContent` resolves to. */
interface RagContentResult {
  file_id: string;
  title: string | null;
  content: string;
  chunk_range: { start: number; end: number };
  total_chunks: number;
  total_chars: number;
  source_created_at: string | null;
  source_modified_at: string | null;
  chunks: { index: number; content: string }[] | null;
}

function createRagResult(
  overrides?: Partial<RagContentResult>,
): RagContentResult {
  return {
    file_id: FILE_ID,
    title: 'Test Document',
    content: 'Hello world',
    chunk_range: { start: 1, end: 5 },
    total_chunks: 10,
    total_chars: 11,
    source_created_at: null,
    source_modified_at: null,
    chunks: null,
    ...overrides,
  };
}

/**
 * Build a typed `ActionCtx` mock whose `runAction` resolves to `result`. The
 * RAG document-content fetch now flows through an in-process `ctx.runAction`,
 * so the test exercises that contract instead of `globalThis.fetch`/`RAG_URL`.
 * The returned `runAction` spy is asserted against; all other members are
 * typed stubs (never invoked by the helper).
 */
function createCtx(result: RagContentResult | null) {
  const runAction = vi.fn().mockResolvedValue(result);
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

let runAction: ReturnType<typeof createCtx>['runAction'];
let ctx: ActionCtx;

function mockResult(result: RagContentResult | null): void {
  ({ ctx, runAction } = createCtx(result));
}

beforeEach(() => {
  mockResult(createRagResult());
});

describe('fetchDocumentContent', () => {
  it('returns correct result shape on happy path', async () => {
    const result = await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID);

    expect(result).toEqual({
      fileId: FILE_ID,
      name: 'Test Document',
      content: 'Hello world',
      chunkRange: { start: 1, end: 5 },
      totalChunks: 10,
      truncated: false,
      totalChars: 11,
      chunks: undefined,
    });
  });

  it('calls getContent with null chunk args when no options provided', async () => {
    await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID);

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: FILE_ID,
      chunkStart: null,
      chunkEnd: null,
      returnChunks: null,
    });
  });

  it('forwards chunkStart and chunkEnd as runAction args', async () => {
    await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID, {
      chunkStart: 3,
      chunkEnd: 8,
    });

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: FILE_ID,
      chunkStart: 3,
      chunkEnd: 8,
      returnChunks: null,
    });
  });

  it('forwards returnChunks and maps returned chunks', async () => {
    mockResult(
      createRagResult({
        chunks: [
          { index: 1, content: 'chunk 1' },
          { index: 2, content: 'chunk 2' },
        ],
      }),
    );

    const result = await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID, {
      returnChunks: true,
    });

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: FILE_ID,
      chunkStart: null,
      chunkEnd: null,
      returnChunks: true,
    });
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks?.[0]).toEqual({ index: 1, content: 'chunk 1' });
  });

  it('passes returnChunks:null as runAction arg when not set', async () => {
    await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID);

    const [, args] = runAction.mock.calls[0] ?? [];
    expect(args).toMatchObject({ returnChunks: null });
  });

  it('forwards the raw fileId untouched (no URL encoding)', async () => {
    await fetchDocumentContent(ctx, ORG_SLUG, 'file/with spaces');

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: 'file/with spaces',
      chunkStart: null,
      chunkEnd: null,
      returnChunks: null,
    });
  });

  it('truncates content exceeding 50K chars', async () => {
    const longContent = 'x'.repeat(60_000);
    mockResult(createRagResult({ content: longContent, total_chars: 60_000 }));

    const result = await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID);

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(50_000);
    expect(result.totalChars).toBe(60_000);
  });

  it('does not truncate content at exactly 50K chars', async () => {
    const exactContent = 'x'.repeat(50_000);
    mockResult(createRagResult({ content: exactContent, total_chars: 50_000 }));

    const result = await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID);

    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(50_000);
  });

  it('handles empty content', async () => {
    mockResult(createRagResult({ content: '', total_chars: 0 }));

    const result = await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID);

    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe(0);
  });

  it('returns "Untitled" when RAG title is null', async () => {
    mockResult(createRagResult({ title: null }));

    const result = await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID);

    expect(result.name).toBe('Untitled');
  });

  it('throws "not found" when getContent returns null', async () => {
    mockResult(null);

    await expect(fetchDocumentContent(ctx, ORG_SLUG, FILE_ID)).rejects.toThrow(
      'was not found in the knowledge base',
    );
  });

  it('combines chunkStart with returnChunks in runAction args', async () => {
    mockResult(createRagResult({ chunks: [{ index: 5, content: 'chunk 5' }] }));

    await fetchDocumentContent(ctx, ORG_SLUG, FILE_ID, {
      chunkStart: 5,
      returnChunks: true,
    });

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: FILE_ID,
      chunkStart: 5,
      chunkEnd: null,
      returnChunks: true,
    });
  });
});
