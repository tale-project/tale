// Dispatch after the queue moved onto workpools.
//
// Concurrency is no longer this module's job, so there is nothing here about
// caps, parking or promotion — the pool owns all three. What is left to pin is
// the routing (which action, which pool) and the completion callback.
//
// `./rag_pools` is mocked so the pools are observable without registering the
// components: an unregistered component makes convexTest throw, and these are
// plain-ctx unit tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_actions: { uploadFileToRag: 'uploadFileToRag' },
      rag_dispatch: { recordRagJobResult: 'recordRagJobResult' },
    },
    documents: {
      internal_actions: { uploadDocumentToRag: 'uploadDocumentToRag' },
    },
  },
}));

const interactiveEnqueue = vi.fn();
const backgroundEnqueue = vi.fn();
const INTERACTIVE = { enqueueAction: interactiveEnqueue };
const BACKGROUND = { enqueueAction: backgroundEnqueue };

vi.mock('./rag_pools', () => ({
  ragInteractivePool: INTERACTIVE,
  ragBackgroundPool: BACKGROUND,
  // The real rule, restated as the smallest thing that can express it: only
  // 'user' is interactive, everything else — including undefined — is not.
  ragPoolFor: (source: string | undefined) =>
    source === 'user' ? INTERACTIVE : BACKGROUND,
}));

const dispatchModule = await import('./rag_dispatch');
const { maybeDispatchRagIndexing } = dispatchModule;
type Handler = (ctx: unknown, args: Record<string, unknown>) => Promise<null>;
const recordResult = (
  dispatchModule.recordRagJobResult as unknown as { handler: Handler }
).handler;

type Ctx = Parameters<typeof maybeDispatchRagIndexing>[0];

interface Row {
  _id: string;
  storageId: string;
  organizationId: string;
  ragStatus?: string;
  ragParked?: boolean;
  source?: string;
  fileName: string;
  contentType: string;
  documentId?: string;
  threadId?: string;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    _id: 'fm_1',
    storageId: 'blob_1',
    organizationId: 'org_1',
    ragStatus: 'queued',
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    ...overrides,
  };
}

/** A ctx over one fileMetadata row, plus whatever documents a case needs. */
function createCtx(
  target: Row | null,
  documents: Record<string, unknown> = {},
) {
  const patches: Record<string, unknown>[] = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({ first: async () => target }),
      }),
      get: async (id: string) => documents[id] ?? null,
      patch: async (id: string, fields: Record<string, unknown>) => {
        patches.push({ id, ...fields });
      },
    },
  } as unknown as Ctx;
  return { ctx, patches };
}

describe('maybeDispatchRagIndexing — routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a member upload to the interactive pool', async () => {
    const { ctx } = createCtx(row({ source: 'user' }));
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    expect(interactiveEnqueue).toHaveBeenCalledTimes(1);
    expect(backgroundEnqueue).not.toHaveBeenCalled();
  });

  it('sends a connector import to the background pool', async () => {
    const { ctx } = createCtx(row({ source: 'google_drive' }));
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    expect(backgroundEnqueue).toHaveBeenCalledTimes(1);
    expect(interactiveEnqueue).not.toHaveBeenCalled();
  });

  it('sends an unstamped row to the background pool', async () => {
    // The fail-safe direction: a background job mistaken for interactive can
    // starve a member's upload, which is the defect the split exists to fix.
    const { ctx } = createCtx(row({ source: undefined }));
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    expect(backgroundEnqueue).toHaveBeenCalledTimes(1);
    expect(interactiveEnqueue).not.toHaveBeenCalled();
  });

  it('indexes a current Hub row through the documents pipeline', async () => {
    const { ctx } = createCtx(row({ source: 'user', documentId: 'doc_1' }), {
      doc_1: { organizationId: 'org_1', fileId: 'blob_1' },
    });
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    const [, fn, args] = interactiveEnqueue.mock.calls[0] ?? [];
    expect(fn).toBe('uploadDocumentToRag');
    expect(args).toMatchObject({
      documentId: 'doc_1',
      expectedFileId: 'blob_1',
    });
  });

  it('treats a chat-bound row as a plain file upload', async () => {
    // `documentId` AND `threadId` is a chat upload, not a Hub document, so it
    // must not go through the documents pipeline.
    const { ctx } = createCtx(
      row({ source: 'user', documentId: 'doc_1', threadId: 'thread_1' }),
    );
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    expect(interactiveEnqueue.mock.calls[0]?.[1]).toBe('uploadFileToRag');
  });

  it('enqueues the completion callback with the row it indexed', async () => {
    const { ctx } = createCtx(row({ source: 'user' }));
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    const opts = interactiveEnqueue.mock.calls[0]?.[3];
    expect(opts).toMatchObject({
      onComplete: 'recordRagJobResult',
      context: { storageId: 'blob_1' },
    });
  });
});

describe('maybeDispatchRagIndexing — rows it refuses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing for a missing row', async () => {
    const { ctx } = createCtx(null);
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    expect(interactiveEnqueue).not.toHaveBeenCalled();
    expect(backgroundEnqueue).not.toHaveBeenCalled();
  });

  it('does nothing for a row that is not queued', async () => {
    const { ctx } = createCtx(row({ ragStatus: 'completed' }));
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    expect(interactiveEnqueue).not.toHaveBeenCalled();
    expect(backgroundEnqueue).not.toHaveBeenCalled();
  });

  it('fails a Hub row whose document has moved on, without enqueueing', async () => {
    const { ctx, patches } = createCtx(
      row({ source: 'user', documentId: 'doc_1' }),
      { doc_1: { organizationId: 'org_1', fileId: 'blob_NEWER' } },
    );
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    expect(interactiveEnqueue).not.toHaveBeenCalled();
    expect(patches[0]).toMatchObject({ ragStatus: 'failed' });
  });

  it('clears a park flag left by a row that predates the pools', async () => {
    // Nothing writes `ragParked` any more. Left set, such a row would read as
    // parked forever — the defect (#2986) this change removes.
    const { ctx, patches } = createCtx(
      row({ source: 'user', ragParked: true }),
    );
    await maybeDispatchRagIndexing(ctx, 'blob_1');
    expect(patches[0]).toMatchObject({ ragParked: undefined });
    expect(interactiveEnqueue).toHaveBeenCalledTimes(1);
  });
});

describe('recordRagJobResult — what the pool reports back', () => {
  it('marks a row failed when the job failed', async () => {
    const { ctx, patches } = createCtx(row({ ragStatus: 'running' }));
    await recordResult(ctx, {
      workId: 'w1',
      context: { storageId: 'blob_1' },
      result: { kind: 'failed', error: 'knowledge-db unreachable' },
    });
    expect(patches[0]).toMatchObject({
      ragStatus: 'failed',
      ragError: 'knowledge-db unreachable',
    });
  });

  it('marks a row failed when the job was canceled', async () => {
    // A cancel from the dashboard, or the pool's recovery pass finding a job
    // whose completion never ran. Without this the row sits at `running`
    // forever, which is what the watchdog existed to catch.
    const { ctx, patches } = createCtx(row({ ragStatus: 'running' }));
    await recordResult(ctx, {
      workId: 'w1',
      context: { storageId: 'blob_1' },
      result: { kind: 'canceled' },
    });
    expect(patches[0]).toMatchObject({ ragStatus: 'failed' });
  });

  it('writes nothing on success', async () => {
    // The indexing action writes `completed` with its chunk counts; this
    // mutation has no such detail and must not overwrite it.
    const { ctx, patches } = createCtx(row({ ragStatus: 'running' }));
    await recordResult(ctx, {
      workId: 'w1',
      context: { storageId: 'blob_1' },
      result: { kind: 'success', returnValue: null },
    });
    expect(patches).toEqual([]);
  });

  it('leaves an already-completed row alone', async () => {
    // A straggling failure from a killed sibling must not undo a real success.
    const { ctx, patches } = createCtx(row({ ragStatus: 'completed' }));
    await recordResult(ctx, {
      workId: 'w1',
      context: { storageId: 'blob_1' },
      result: { kind: 'failed', error: 'too late' },
    });
    expect(patches).toEqual([]);
  });

  it('does nothing when the row is gone', async () => {
    const { ctx, patches } = createCtx(null);
    await recordResult(ctx, {
      workId: 'w1',
      context: { storageId: 'blob_1' },
      result: { kind: 'failed', error: 'x' },
    });
    expect(patches).toEqual([]);
  });
});
