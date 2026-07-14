import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_actions: { uploadFileToRag: 'uploadFileToRag' },
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
  fileName: string;
  contentType: string;
  _creationTime: number;
}

function makeCtx(rows: Row[]) {
  const store = rows.map((r) => ({ ...r }));
  const scheduled: Array<{ ref: unknown; args: { storageId: string } }> = [];
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
    },
    scheduler: {
      runAfter: async (
        _d: number,
        ref: unknown,
        args: { storageId: string },
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
    await maybeDispatchRagIndexing(ctx, 'a' as never);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args.storageId).toBe('a');
    expect(store.find((r) => r._id === 'a')?.ragParked).toBeUndefined();
  });

  it('allows exactly the cap concurrently (target excluded from its own count)', async () => {
    // 2 already in flight + this one = 3 = cap → dispatch.
    const rows = [
      row('a', { ragStatus: 'running' }),
      row('b', { ragStatus: 'running' }),
      row('c'),
    ];
    const { ctx, scheduled } = makeCtx(rows);
    await maybeDispatchRagIndexing(ctx, 'c' as never);
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
    await maybeDispatchRagIndexing(ctx, 'd' as never);
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
    await maybeDispatchRagIndexing(ctx, 'c' as never);
    expect(scheduled).toHaveLength(1);
  });

  it('no-ops for a non-queued or missing row', async () => {
    const { ctx, scheduled } = makeCtx([row('a', { ragStatus: 'completed' })]);
    await maybeDispatchRagIndexing(ctx, 'a' as never);
    await maybeDispatchRagIndexing(ctx, 'missing' as never);
    expect(scheduled).toHaveLength(0);
  });
});

describe('promoteQueuedRagJobs', () => {
  it('promotes parked rows until the cap is reached', async () => {
    // 1 running + 3 parked → 2 free slots → promote 2, leave 1 parked.
    const rows = [
      row('r', { ragStatus: 'running' }),
      row('p1', { ragParked: true }),
      row('p2', { ragParked: true }),
      row('p3', { ragParked: true }),
    ];
    const { ctx, scheduled, store } = makeCtx(rows);
    await promoteQueuedRagJobs(ctx, 'org');
    expect(scheduled).toHaveLength(2);
    expect(store.filter((r) => r.ragParked === true)).toHaveLength(1);
  });

  it('promotes nothing when already at the cap', async () => {
    const rows = [
      row('a', { ragStatus: 'running' }),
      row('b', { ragStatus: 'running' }),
      row('c', { ragStatus: 'running' }),
      row('p', { ragParked: true }),
    ];
    const { ctx, scheduled } = makeCtx(rows);
    await promoteQueuedRagJobs(ctx, 'org');
    expect(scheduled).toHaveLength(0);
  });

  it('is a no-op when there are no parked rows', async () => {
    const { ctx, scheduled } = makeCtx([row('a', { ragStatus: 'running' })]);
    await promoteQueuedRagJobs(ctx, 'org');
    expect(scheduled).toHaveLength(0);
  });
});
