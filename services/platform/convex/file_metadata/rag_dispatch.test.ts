import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_actions: { uploadFileToRag: 'uploadFileToRag' },
    },
    documents: {
      internal_actions: { uploadDocumentToRag: 'uploadDocumentToRag' },
    },
  },
}));

const { maybeDispatchRagIndexing, promoteQueuedRagJobs } =
  await import('./rag_dispatch');

type Ctx = Parameters<typeof maybeDispatchRagIndexing>[0];

interface Row {
  _id: string;
  storageId: string;
  organizationId: string;
  ragStatus?: string;
  ragParked?: boolean;
  ragError?: string;
  ragProgress?: string;
  fileName: string;
  contentType: string;
  _creationTime: number;
  documentId?: string;
  threadId?: string;
}

function makeCtx(rows: Row[], currentFiles: Record<string, string> = {}) {
  const store = rows.map((r) => ({ ...r }));
  const scheduled: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, fn: (q: unknown) => unknown) => {
          const constraints: Record<string, unknown> = {};
          const q = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return q;
            },
          };
          fn(q);
          const filtered = store.filter((r) =>
            Object.entries(constraints).every(
              ([k, v]) => (r as Record<string, unknown>)[k] === v,
            ),
          );
          return {
            first: async () => filtered[0] ?? null,
            async *[Symbol.asyncIterator]() {
              for (const r of filtered) yield r;
            },
          };
        },
      }),
      patch: async (id: string, updates: Record<string, unknown>) => {
        const target = store.find((r) => r._id === id);
        if (target) Object.assign(target, updates);
      },
      get: async (id: string) => {
        const currentFile = currentFiles[id];
        if (currentFile !== undefined) {
          return { _id: id, organizationId: 'org', fileId: currentFile };
        }
        const linked = store.find((r) => r.documentId === id);
        return linked
          ? {
              _id: id,
              organizationId: linked.organizationId,
              fileId: linked.storageId,
            }
          : null;
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
  return { ctx: ctx as unknown as Ctx, scheduled, store };
}

function row(id: string, over: Partial<Row> = {}): Row {
  return {
    _id: id,
    storageId: id,
    organizationId: 'org',
    ragStatus: 'queued',
    fileName: 'f.pdf',
    contentType: 'application/pdf',
    _creationTime: 1,
    ...over,
  };
}

describe('maybeDispatchRagIndexing — per-org concurrency cap', () => {
  it('dispatches when the org is under the cap', async () => {
    const { ctx, scheduled, store } = makeCtx([row('a')]);
    await maybeDispatchRagIndexing(ctx, 'a');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args.storageId).toBe('a');
    expect(scheduled[0].ref).toBe('uploadFileToRag');
    expect(store.find((r) => r._id === 'a')?.ragParked).toBeUndefined();
  });

  it('dispatches a Document Hub row through the documents pipeline', async () => {
    // documentId set + no threadId → uploadDocumentToRag with the exact blob
    // admitted by this row, NOT whatever file the document points at later.
    const { ctx, scheduled } = makeCtx([row('a', { documentId: 'doc1' })]);
    await maybeDispatchRagIndexing(ctx, 'a');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ref).toBe('uploadDocumentToRag');
    expect(scheduled[0].args).toEqual({
      documentId: 'doc1',
      expectedFileId: 'a',
    });
  });

  it('treats a chat-bound row (documentId + threadId) as a file upload', async () => {
    const { ctx, scheduled } = makeCtx([
      row('a', { documentId: 'doc1', threadId: 'thread1' }),
    ]);
    await maybeDispatchRagIndexing(ctx, 'a');
    expect(scheduled[0].ref).toBe('uploadFileToRag');
  });

  it('allows exactly the cap concurrently (target excluded from its own count)', async () => {
    // 2 already in flight + this one = 3 = cap → dispatch.
    const rows = [
      row('a', { ragStatus: 'running' }),
      row('b', { ragStatus: 'running' }),
      row('c'),
    ];
    const { ctx, scheduled } = makeCtx(rows);
    await maybeDispatchRagIndexing(ctx, 'c');
    expect(scheduled).toHaveLength(1);
  });

  it('parks when the org is at the cap', async () => {
    const rows = [
      row('a', { ragStatus: 'running' }),
      row('b', { ragStatus: 'running' }),
      row('c', { ragStatus: 'running' }),
      row('d'),
    ];
    const { ctx, scheduled, store } = makeCtx(rows);
    await maybeDispatchRagIndexing(ctx, 'd');
    expect(scheduled).toHaveLength(0);
    expect(store.find((r) => r._id === 'd')?.ragParked).toBe(true);
  });

  it('does not count parked rows as in flight', async () => {
    // 2 running + 1 parked: the parked one is not in flight, so a new upload
    // still has a free slot.
    const rows = [
      row('a', { ragStatus: 'running' }),
      row('b', { ragStatus: 'running' }),
      row('p', { ragParked: true }),
      row('c'),
    ];
    const { ctx, scheduled } = makeCtx(rows);
    await maybeDispatchRagIndexing(ctx, 'c');
    expect(scheduled).toHaveLength(1);
  });

  it('no-ops for a non-queued or missing row', async () => {
    const { ctx, scheduled } = makeCtx([row('a', { ragStatus: 'completed' })]);
    await maybeDispatchRagIndexing(ctx, 'a');
    await maybeDispatchRagIndexing(ctx, 'missing');
    expect(scheduled).toHaveLength(0);
  });

  it('parks when the global budget is full even if the org is idle', async () => {
    // 8 running across other orgs = global cap. A fresh org's first upload
    // still has to wait for the shared budget.
    const rows: Row[] = [];
    for (let i = 0; i < 8; i += 1) {
      rows.push(
        row(`r${i}`, { organizationId: `o${i}`, ragStatus: 'running' }),
      );
    }
    rows.push(row('c', { organizationId: 'fresh' }));
    const { ctx, scheduled, store } = makeCtx(rows);
    await maybeDispatchRagIndexing(ctx, 'c');
    expect(scheduled).toHaveLength(0);
    expect(store.find((r) => r._id === 'c')?.ragParked).toBe(true);
  });

  it('charges an unparked queued row against the cap even with nothing scheduled', async () => {
    // The cost model behind the `ragParked` contract in schema.ts: the counter
    // cannot see whether a row's action was ever dispatched, so an unparked
    // `'queued'` row is charged a slot on trust. Three of them saturate a
    // whole org — which is exactly how email attachments stored with
    // `deferRagDispatch` (a promise to dispatch that nothing kept) starved
    // every real upload. A writer that marks a row queued without dispatching
    // is therefore not merely untidy; it is indistinguishable from live work.
    const rows = [row('e1'), row('e2'), row('e3'), row('upload')];
    const { ctx, scheduled, store } = makeCtx(rows);
    await maybeDispatchRagIndexing(ctx, 'upload');
    expect(scheduled).toHaveLength(0);
    expect(store.find((r) => r._id === 'upload')?.ragParked).toBe(true);
  });

  it('leaves a slot free for a row stored with indexing skipped', async () => {
    // The fixed email-attachment shape: `skipRagIndexing` leaves `ragStatus`
    // unset, so the row is in neither status bucket and costs nothing. Three
    // of them plus a real upload still dispatches.
    const rows = [
      row('e1', { ragStatus: undefined }),
      row('e2', { ragStatus: undefined }),
      row('e3', { ragStatus: undefined }),
      row('upload'),
    ];
    const { ctx, scheduled, store } = makeCtx(rows);
    await maybeDispatchRagIndexing(ctx, 'upload');
    expect(scheduled).toHaveLength(1);
    expect(store.find((r) => r._id === 'upload')?.ragParked).toBeUndefined();
  });
});

describe('promoteQueuedRagJobs', () => {
  it('fails parked B after replacement and dispatches current C exactly once', async () => {
    const rows = [
      row('B', {
        documentId: 'doc1',
        ragParked: true,
        _creationTime: 1,
      }),
      row('C', {
        documentId: 'doc1',
        ragParked: true,
        _creationTime: 2,
      }),
    ];
    const { ctx, scheduled, store } = makeCtx(rows, { doc1: 'C' });

    await promoteQueuedRagJobs(ctx);

    expect(scheduled).toEqual([
      {
        ref: 'uploadDocumentToRag',
        args: { documentId: 'doc1', expectedFileId: 'C' },
      },
    ]);
    expect(store.find((r) => r.storageId === 'B')).toMatchObject({
      ragStatus: 'failed',
      ragError: 'Indexing stopped because this file was replaced.',
    });
    expect(store.find((r) => r.storageId === 'C')?.ragParked).toBeUndefined();
  });

  it('promotes parked rows until the per-org cap is reached', async () => {
    // 1 running + 3 parked (same org) → per-org cap 3 → promote 2, leave 1.
    const rows = [
      row('r', { ragStatus: 'running' }),
      row('p1', { ragParked: true }),
      row('p2', { ragParked: true }),
      row('p3', { ragParked: true }),
    ];
    const { ctx, scheduled, store } = makeCtx(rows);
    await promoteQueuedRagJobs(ctx);
    expect(scheduled).toHaveLength(2);
    expect(store.filter((r) => r.ragParked === true)).toHaveLength(1);
  });

  it('promotes nothing when the org is already at the cap', async () => {
    const rows = [
      row('a', { ragStatus: 'running' }),
      row('b', { ragStatus: 'running' }),
      row('c', { ragStatus: 'running' }),
      row('p', { ragParked: true }),
    ];
    const { ctx, scheduled } = makeCtx(rows);
    await promoteQueuedRagJobs(ctx);
    expect(scheduled).toHaveLength(0);
  });

  it('is a no-op when there are no parked rows', async () => {
    const { ctx, scheduled } = makeCtx([row('a', { ragStatus: 'running' })]);
    await promoteQueuedRagJobs(ctx);
    expect(scheduled).toHaveLength(0);
  });

  it('caps one org at its per-org share even with the most/oldest parked', async () => {
    // Org A parked 5 (oldest, _creationTime 1..5), org B parked 2 (newer).
    // Fair promotion: A takes only 3 (per-org cap), B takes both. A keeps 2.
    const rows = [
      ...[1, 2, 3, 4, 5].map((i) =>
        row(`a${i}`, {
          organizationId: 'A',
          ragParked: true,
          _creationTime: i,
        }),
      ),
      ...[6, 7].map((i) =>
        row(`b${i}`, {
          organizationId: 'B',
          ragParked: true,
          _creationTime: i,
        }),
      ),
    ];
    const { ctx, scheduled, store } = makeCtx(rows);
    await promoteQueuedRagJobs(ctx);
    expect(scheduled).toHaveLength(5); // 3 from A + 2 from B
    const aParked = store.filter(
      (r) => r.organizationId === 'A' && r.ragParked === true,
    );
    expect(aParked).toHaveLength(2);
    const bParked = store.filter(
      (r) => r.organizationId === 'B' && r.ragParked === true,
    );
    expect(bParked).toHaveLength(0);
  });

  it('bounds total promotions by the global cap across orgs', async () => {
    // 3 orgs × 3 parked = 9 promotable per per-org caps, but the global cap
    // (8) binds → 8 dispatched, 1 stays parked.
    const rows: Row[] = [];
    let t = 1;
    for (const org of ['A', 'B', 'C']) {
      for (let i = 0; i < 3; i += 1) {
        rows.push(
          row(`${org}${i}`, {
            organizationId: org,
            ragParked: true,
            _creationTime: t++,
          }),
        );
      }
    }
    const { ctx, scheduled, store } = makeCtx(rows);
    await promoteQueuedRagJobs(ctx);
    expect(scheduled).toHaveLength(8);
    expect(store.filter((r) => r.ragParked === true)).toHaveLength(1);
  });

  it('does not promote when the global budget is already full', async () => {
    // 8 running across orgs = global cap; a parked row in a fresh org waits.
    const rows: Row[] = [];
    for (let i = 0; i < 8; i += 1) {
      rows.push(
        row(`r${i}`, { organizationId: `o${i}`, ragStatus: 'running' }),
      );
    }
    rows.push(row('p', { organizationId: 'fresh', ragParked: true }));
    const { ctx, scheduled } = makeCtx(rows);
    await promoteQueuedRagJobs(ctx);
    expect(scheduled).toHaveLength(0);
  });
});
