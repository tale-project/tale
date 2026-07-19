import type { ToolCtx } from '@convex-dev/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import { documentRetrieveArgs } from './document_retrieve_tool';
import { retrieveDocument } from './helpers/retrieve_document';

const FILE_ID = 'file-storage-123';
// Production-shaped document id so orgSlugFromId's syntactic gate lets the
// mocked runQuery answer through (short fixtures like 'org1' are rejected).
const ORG_ID = 'jn7e5agwkrztazsh38bq0zt73n87e20w';
const USER_ID = 'user1';
const ORG_SLUG = 'org-1';

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
 * The sequenced values `ctx.runQuery` resolves to, in call order. The resolved
 * shapes are heterogeneous (a document row, an accessible-id list, an org slug
 * row, a video-source list), so the sequence is modelled as opaque values; the
 * helper only reads the fields each path needs.
 */
function withQueryResults(
  runQuery: ReturnType<typeof vi.fn>,
  results: readonly unknown[],
): void {
  for (const result of results) runQuery.mockResolvedValueOnce(result);
}

/**
 * `runQuery` result sequence for the knowledge-base-hub happy path:
 * findDocumentByFileId → getAccessibleDocumentIds → betterAuth findOne
 * (org slug) → lookupVideoLinkSources.
 */
const HUB_QUERY_RESULTS: readonly unknown[] = [
  { _id: 'doc123', fileId: FILE_ID, title: 'Test' },
  ['doc123', 'doc456'],
  { slug: ORG_SLUG },
  [],
];

/**
 * `retrieveDocument` resolves access control through `ctx.runQuery` and then
 * delegates the actual content read to `fetchDocumentContent`, which now flows
 * through an in-process `ctx.runAction(internal.rag.documents.getContent)`
 * instead of `globalThis.fetch`/`RAG_URL`. This test exercises that contract:
 * the `runQuery` spy drives the resolution path (sequenced per test) and the
 * `runAction` spy resolves to the RAG payload. Both spies are returned for
 * assertion; all other `ToolCtx` members are typed stubs the helper never
 * invokes.
 */
function createCtx(options: {
  queryResults: readonly unknown[];
  ragResult: RagContentResult | null;
  organizationId?: string;
  userId?: string;
}) {
  const runQuery = vi.fn();
  withQueryResults(runQuery, options.queryResults);
  const runAction = vi.fn().mockResolvedValue(options.ragResult);
  const ctx: ToolCtx = {
    organizationId: options.organizationId,
    userId: options.userId,
    runQuery,
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
  return { ctx, runQuery, runAction };
}

let runAction: ReturnType<typeof createCtx>['runAction'];
let ctx: ToolCtx;

beforeEach(() => {
  ({ ctx, runAction } = createCtx({
    queryResults: HUB_QUERY_RESULTS,
    ragResult: createRagResult(),
    organizationId: ORG_ID,
    userId: USER_ID,
  }));
});

describe('retrieveDocument helper', () => {
  it('returns correct result shape on happy path', async () => {
    const result = await retrieveDocument(ctx, { fileId: FILE_ID });

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

  it('forwards chunkStart and chunkEnd as runAction args', async () => {
    await retrieveDocument(ctx, {
      fileId: FILE_ID,
      chunkStart: 5,
      chunkEnd: 15,
    });

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: FILE_ID,
      chunkStart: 5,
      chunkEnd: 15,
      returnChunks: null,
    });
  });

  it('passes null chunk args to runAction when not provided', async () => {
    await retrieveDocument(ctx, { fileId: FILE_ID });

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: FILE_ID,
      chunkStart: null,
      chunkEnd: null,
      returnChunks: null,
    });
  });

  it('forwards the raw fileId untouched (no URL encoding)', async () => {
    ({ ctx, runAction } = createCtx({
      queryResults: [
        { _id: 'doc-slashes', fileId: 'file/with slashes', title: 'Test' },
        ['doc-slashes'],
        { slug: ORG_SLUG },
        [],
      ],
      ragResult: createRagResult({ file_id: 'file/with slashes' }),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await retrieveDocument(ctx, { fileId: 'file/with slashes' });

    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: 'file/with slashes',
      chunkStart: null,
      chunkEnd: null,
      returnChunks: null,
    });
  });

  it('truncates content exceeding 50K chars', async () => {
    const longContent = 'x'.repeat(60_000);
    ({ ctx, runAction } = createCtx({
      queryResults: HUB_QUERY_RESULTS,
      ragResult: createRagResult({ content: longContent, total_chars: 60_000 }),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: FILE_ID });

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(50_000);
    expect(result.totalChars).toBe(60_000);
  });

  it('does not truncate content at exactly 50K chars', async () => {
    const exactContent = 'x'.repeat(50_000);
    ({ ctx, runAction } = createCtx({
      queryResults: HUB_QUERY_RESULTS,
      ragResult: createRagResult({
        content: exactContent,
        total_chars: 50_000,
      }),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: FILE_ID });

    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(50_000);
  });

  it('throws when organizationId is missing', async () => {
    ({ ctx } = createCtx({
      queryResults: HUB_QUERY_RESULTS,
      ragResult: createRagResult(),
      organizationId: undefined,
      userId: USER_ID,
    }));

    await expect(retrieveDocument(ctx, { fileId: FILE_ID })).rejects.toThrow(
      'organizationId is required',
    );
  });

  it('throws when userId is missing', async () => {
    ({ ctx } = createCtx({
      queryResults: HUB_QUERY_RESULTS,
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: undefined,
    }));

    await expect(retrieveDocument(ctx, { fileId: FILE_ID })).rejects.toThrow(
      'userId is required',
    );
  });

  it('throws when fileId is in neither documents hub nor fileMetadata', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        null, // findDocumentByFileId — no hub row
        null, // getByStorageId — no metadata
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(
      retrieveDocument(ctx, { fileId: 'nonexistent-file' }),
    ).rejects.toThrow('Document not found');
  });

  it('falls back to fileMetadata + RAG for chat-uploaded files not in documents hub', async () => {
    ({ ctx, runAction } = createCtx({
      queryResults: [
        null, // findDocumentByFileId — no hub row
        {
          organizationId: ORG_ID,
          storageId: 'chat-upload-1',
          ragStatus: 'completed',
        }, // getByStorageId — chat attachment, indexed
        { slug: ORG_SLUG }, // orgSlugFromId → betterAuth findOne
        [], // lookupVideoLinkSources
      ],
      ragResult: createRagResult({
        file_id: 'chat-upload-1',
        title: 'Chat Attachment',
      }),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: 'chat-upload-1' });

    expect(result.name).toBe('Chat Attachment');
    expect(result.content).toBe('Hello world');
    expect(runAction).toHaveBeenCalledWith(internal.rag.documents.getContent, {
      orgSlug: ORG_SLUG,
      fileId: 'chat-upload-1',
      chunkStart: null,
      chunkEnd: null,
      returnChunks: null,
    });
  });

  it('rejects fileMetadata from a different organization as not found', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        null, // findDocumentByFileId — no hub row
        {
          organizationId: 'other-org',
          storageId: 'chat-upload-1',
          ragStatus: 'completed',
        }, // getByStorageId — foreign-org metadata
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(
      retrieveDocument(ctx, { fileId: 'chat-upload-1' }),
    ).rejects.toThrow('Document not found');
  });

  it('throws transient error when chat attachment is still being indexed', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        null, // findDocumentByFileId — no hub row
        {
          organizationId: ORG_ID,
          storageId: 'chat-upload-1',
          ragStatus: 'running',
        }, // getByStorageId — still indexing
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(
      retrieveDocument(ctx, { fileId: 'chat-upload-1' }),
    ).rejects.toThrow('still being indexed');
  });

  it('throws transient error when ragStatus is undefined (pending)', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        null, // findDocumentByFileId — no hub row
        {
          organizationId: ORG_ID,
          storageId: 'chat-upload-1',
          // ragStatus undefined
        }, // getByStorageId — pending (no status)
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(
      retrieveDocument(ctx, { fileId: 'chat-upload-1' }),
    ).rejects.toThrow('still being indexed');
  });

  it('throws with stored ragError when indexing has failed', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        null, // findDocumentByFileId — no hub row
        {
          organizationId: ORG_ID,
          storageId: 'chat-upload-1',
          ragStatus: 'failed',
          ragError: 'crawler timeout after 3 retries',
        }, // getByStorageId — indexing failed
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(
      retrieveDocument(ctx, { fileId: 'chat-upload-1' }),
    ).rejects.toThrow('crawler timeout after 3 retries');
  });

  it('does not call getAccessibleDocumentIds on the fileMetadata fallback path', async () => {
    let runQuery: ReturnType<typeof createCtx>['runQuery'];
    ({ ctx, runQuery } = createCtx({
      queryResults: [
        null, // findDocumentByFileId — no hub row
        {
          organizationId: ORG_ID,
          storageId: 'chat-upload-1',
          ragStatus: 'completed',
        }, // getByStorageId
        { slug: ORG_SLUG }, // orgSlugFromId → betterAuth findOne
        [], // lookupVideoLinkSources
      ],
      ragResult: createRagResult({ file_id: 'chat-upload-1' }),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await retrieveDocument(ctx, { fileId: 'chat-upload-1' });

    const queryIdentifiers = runQuery.mock.calls.map((call) => call[0]);
    expect(queryIdentifiers).not.toContain(
      internal.documents.internal_queries.getAccessibleDocumentIds,
    );
  });

  it('throws when document is not in accessible IDs', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        { _id: 'doc123', fileId: FILE_ID, title: 'Test' }, // findDocumentByFileId
        ['other-doc'], // getAccessibleDocumentIds — doc123 not included
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(retrieveDocument(ctx, { fileId: FILE_ID })).rejects.toThrow(
      'Access denied for document',
    );
  });

  it('throws "not found in the knowledge base" when getContent returns null', async () => {
    ({ ctx } = createCtx({
      queryResults: HUB_QUERY_RESULTS,
      ragResult: null,
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(retrieveDocument(ctx, { fileId: FILE_ID })).rejects.toThrow(
      'was not found in the knowledge base',
    );
  });

  it('handles empty content from RAG gracefully', async () => {
    ({ ctx } = createCtx({
      queryResults: HUB_QUERY_RESULTS,
      ragResult: createRagResult({ content: '', total_chars: 0 }),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: FILE_ID });

    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('returns "Untitled" when RAG response has null title', async () => {
    ({ ctx } = createCtx({
      queryResults: HUB_QUERY_RESULTS,
      ragResult: createRagResult({ title: null }),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: FILE_ID });

    expect(result.name).toBe('Untitled');
  });
});

describe('transcript fallback (RAG index not ready)', () => {
  const TRANSCRIPT = 'Source: https://youtu.be/abc\n\n[00:00:01] hello world';

  /** Chat-attachment `fileMetadata` row carrying a completed transcript —
   * the shape `insertSyntheticFileMetadata` (video captions) and
   * `transcribe_audio` (Whisper) write before RAG indexing finishes. */
  function transcriptRow(overrides?: Record<string, unknown>) {
    return {
      organizationId: ORG_ID,
      storageId: 'chat-upload-1',
      fileName: 'My Video.txt',
      transcript: TRANSCRIPT,
      transcriptionStatus: 'completed',
      ragStatus: 'queued',
      ...overrides,
    };
  }

  it('serves the stored transcript while indexing is pending, without hitting RAG', async () => {
    ({ ctx, runAction } = createCtx({
      queryResults: [
        null, // findDocumentByFileId — no hub row
        transcriptRow(), // getByStorageId — transcript ready, index queued
        [], // lookupVideoLinkSources
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: 'chat-upload-1' });

    expect(result.content).toBe(TRANSCRIPT);
    expect(result.name).toBe('My Video.txt');
    expect(result.chunkRange).toEqual({ start: 1, end: 1 });
    expect(result.totalChunks).toBe(1);
    expect(result.note).toMatch(/still in progress/);
    expect(runAction).not.toHaveBeenCalled();
  });

  it('rescues ragStatus=failed when a transcript exists, noting the failure', async () => {
    ({ ctx, runAction } = createCtx({
      queryResults: [
        null,
        transcriptRow({ ragStatus: 'failed', ragError: 'embedder down' }),
        [],
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: 'chat-upload-1' });

    expect(result.content).toBe(TRANSCRIPT);
    expect(result.note).toMatch(/indexing failed/i);
    expect(result.note).toContain('embedder down');
    expect(runAction).not.toHaveBeenCalled();
  });

  it('wraps video-sourced fallback content as untrusted', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        null,
        transcriptRow(),
        [{ sourceUrl: 'https://youtu.be/abc' }], // lookupVideoLinkSources
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: 'chat-upload-1' });

    expect(result.content).toContain(
      '<untrusted_source tool="document_retrieve" url="https://youtu.be/abc">',
    );
    expect(result.content).toContain(TRANSCRIPT);
    expect(result.content.trimEnd()).toMatch(/<\/untrusted_source>$/);
  });

  it('paginates the transcript with the same chunk protocol', async () => {
    const longTranscript =
      'a'.repeat(2048) + 'b'.repeat(2048) + 'c'.repeat(500);
    ({ ctx } = createCtx({
      queryResults: [null, transcriptRow({ transcript: longTranscript }), []],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, {
      fileId: 'chat-upload-1',
      chunkStart: 2,
      chunkEnd: 2,
    });

    expect(result.content).toBe('b'.repeat(2048));
    expect(result.chunkRange).toEqual({ start: 2, end: 2 });
    expect(result.totalChunks).toBe(3);
  });

  it('keeps the indexing error when transcription has not completed', async () => {
    ({ ctx } = createCtx({
      queryResults: [null, transcriptRow({ transcriptionStatus: 'running' })],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(
      retrieveDocument(ctx, { fileId: 'chat-upload-1' }),
    ).rejects.toThrow('still being indexed');
  });

  it('keeps the failed error when no transcript exists', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        null,
        transcriptRow({
          transcript: '',
          ragStatus: 'failed',
          ragError: 'crawler timeout',
        }),
      ],
      ragResult: createRagResult(),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    await expect(
      retrieveDocument(ctx, { fileId: 'chat-upload-1' }),
    ).rejects.toThrow('RAG indexing failed');
  });

  it('leaves the note unset on the normal RAG path', async () => {
    ({ ctx } = createCtx({
      queryResults: [
        null,
        {
          organizationId: ORG_ID,
          storageId: 'chat-upload-1',
          ragStatus: 'completed',
        },
        { slug: ORG_SLUG },
        [],
      ],
      ragResult: createRagResult({ file_id: 'chat-upload-1' }),
      organizationId: ORG_ID,
      userId: USER_ID,
    }));

    const result = await retrieveDocument(ctx, { fileId: 'chat-upload-1' });

    expect(result.note).toBeUndefined();
  });
});

describe('documentRetrieveArgs schema validation', () => {
  it('accepts valid fileId only', () => {
    const result = documentRetrieveArgs.parse({ fileId: 'abc123' });
    expect(result.fileId).toBe('abc123');
    expect(result.chunkStart).toBeUndefined();
    expect(result.chunkEnd).toBeUndefined();
  });

  it('accepts fileId with chunkStart and chunkEnd', () => {
    const result = documentRetrieveArgs.parse({
      fileId: 'abc123',
      chunkStart: 1,
      chunkEnd: 10,
    });
    expect(result.chunkStart).toBe(1);
    expect(result.chunkEnd).toBe(10);
  });

  it('rejects empty fileId', () => {
    expect(() => documentRetrieveArgs.parse({ fileId: '' })).toThrow();
  });

  it('rejects chunkStart below 1', () => {
    expect(() =>
      documentRetrieveArgs.parse({ fileId: 'abc', chunkStart: 0 }),
    ).toThrow();
  });

  it('rejects chunkEnd below 1', () => {
    expect(() =>
      documentRetrieveArgs.parse({ fileId: 'abc', chunkEnd: 0 }),
    ).toThrow();
  });

  it('rejects non-integer chunkStart', () => {
    expect(() =>
      documentRetrieveArgs.parse({ fileId: 'abc', chunkStart: 1.5 }),
    ).toThrow();
  });

  it('rejects chunkStart greater than chunkEnd', () => {
    expect(() =>
      documentRetrieveArgs.parse({
        fileId: 'abc',
        chunkStart: 10,
        chunkEnd: 5,
      }),
    ).toThrow();
  });

  it('rejects chunk range exceeding 100', () => {
    expect(() =>
      documentRetrieveArgs.parse({
        fileId: 'abc',
        chunkStart: 1,
        chunkEnd: 200,
      }),
    ).toThrow();
  });

  it('accepts chunkStart without chunkEnd', () => {
    const result = documentRetrieveArgs.parse({
      fileId: 'abc',
      chunkStart: 5,
    });
    expect(result.chunkStart).toBe(5);
    expect(result.chunkEnd).toBeUndefined();
  });

  it('accepts chunkEnd without chunkStart', () => {
    const result = documentRetrieveArgs.parse({
      fileId: 'abc',
      chunkEnd: 10,
    });
    expect(result.chunkEnd).toBe(10);
    expect(result.chunkStart).toBeUndefined();
  });
});
