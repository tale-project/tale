import { describe, expect, it, vi } from 'vitest';

import {
  isRagIndexableFile,
  resolveFileType,
} from '../../lib/shared/file-types';

vi.mock('../_generated/api', () => ({
  internal: {
    documents: {
      internal_actions: { uploadDocumentToRag: 'uploadDocumentToRag' },
    },
  },
}));
vi.mock('../file_metadata/rag_dispatch', () => ({
  maybeDispatchRagIndexing: vi.fn(),
}));

const { scheduleHubDocumentRagIndexing } =
  await import('./schedule_hub_document_rag_indexing');
const { maybeDispatchRagIndexing } =
  await import('../file_metadata/rag_dispatch');

type Ctx = Parameters<typeof scheduleHubDocumentRagIndexing>[0];

function makeCtx(document: unknown, fm: unknown) {
  const patched: Array<{ id: string; updates: Record<string, unknown> }> = [];
  const scheduled: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async () => document,
      query: () => ({ withIndex: () => ({ first: async () => fm }) }),
      patch: async (id: string, updates: Record<string, unknown>) => {
        patched.push({ id, updates });
      },
    },
    scheduler: {
      runAfter: async (
        _d: number,
        ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ ref, args });
      },
    },
  };
  return { ctx: ctx as unknown as Ctx, patched, scheduled };
}

describe('OneDrive sync RAG eligibility', () => {
  it('does not index Microsoft Loop files', () => {
    const type = resolveFileType(
      'Daily SCRUM.loop',
      'application/octet-stream',
    );
    expect(isRagIndexableFile('Daily SCRUM.loop', type)).toBe(false);
  });

  it('indexes PDFs even when OneDrive reports octet-stream', () => {
    const type = resolveFileType(
      'status-update.pdf',
      'application/octet-stream',
    );
    expect(isRagIndexableFile('status-update.pdf', type)).toBe(true);
  });

  it('indexes PDFs from resolved application/pdf mime', () => {
    const type = resolveFileType('report', 'application/pdf');
    expect(isRagIndexableFile('report', type)).toBe(true);
  });
});

describe('scheduleHubDocumentRagIndexing — cap routing', () => {
  const doc = {
    _id: 'doc1',
    fileId: 'file1',
    title: 'report.pdf',
    mimeType: 'application/pdf',
  };

  it('routes through the concurrency cap when a fileMetadata row exists', async () => {
    vi.mocked(maybeDispatchRagIndexing).mockClear();
    const { ctx, patched, scheduled } = makeCtx(doc, {
      _id: 'fm1',
      storageId: 'file1',
    });

    const result = await scheduleHubDocumentRagIndexing(ctx, {
      documentId: 'doc1' as never,
    });

    expect(result).toBe(true);
    // Row marked queued (so it counts + the dispatcher's guard passes)…
    expect(patched[0]?.updates.ragStatus).toBe('queued');
    // …then handed to the shared cap gate — NOT dispatched directly.
    expect(maybeDispatchRagIndexing).toHaveBeenCalledWith(
      expect.anything(),
      'file1',
    );
    expect(scheduled).toHaveLength(0);
  });

  it('falls back to a direct dispatch when no fileMetadata row exists yet', async () => {
    vi.mocked(maybeDispatchRagIndexing).mockClear();
    const { ctx, scheduled } = makeCtx(doc, null);

    const result = await scheduleHubDocumentRagIndexing(ctx, {
      documentId: 'doc1' as never,
    });

    expect(result).toBe(true);
    expect(maybeDispatchRagIndexing).not.toHaveBeenCalled();
    expect(scheduled[0]?.ref).toBe('uploadDocumentToRag');
    expect(scheduled[0]?.args.documentId).toBe('doc1');
  });

  it('skips chat-bound rows (threadId set)', async () => {
    vi.mocked(maybeDispatchRagIndexing).mockClear();
    const { ctx, scheduled } = makeCtx(doc, {
      _id: 'fm1',
      storageId: 'file1',
      threadId: 'thread1',
    });

    const result = await scheduleHubDocumentRagIndexing(ctx, {
      documentId: 'doc1' as never,
    });

    expect(result).toBe(false);
    expect(maybeDispatchRagIndexing).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });
});
