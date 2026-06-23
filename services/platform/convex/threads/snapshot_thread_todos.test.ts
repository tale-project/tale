import { beforeEach, describe, expect, it, vi } from 'vitest';

import { copyThreadTodos } from './snapshot_thread_todos';

type Row = Record<string, unknown> & { _id?: string };

/** ctx.db over the threadTodos table: withIndex filters by eq() calls; insert
 * captures the new doc. */
function makeCtx(threadTodos: Row[]) {
  const inserted: Array<{ table: string; doc: Record<string, unknown> }> = [];
  const applyIndex = (cb?: (q: unknown) => unknown): Row[] => {
    if (!cb) return [...threadTodos];
    const eqs: Array<[string, unknown]> = [];
    const q = {
      eq(field: string, value: unknown) {
        eqs.push([field, value]);
        return q;
      },
    };
    cb(q);
    return threadTodos.filter((r) => eqs.every(([f, v]) => r[f] === v));
  };
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, cb?: (q: unknown) => unknown) => ({
          first: () => Promise.resolve(applyIndex(cb)[0] ?? null),
        }),
      }),
      insert: vi.fn((table: string, doc: Record<string, unknown>) => {
        inserted.push({ table, doc });
        threadTodos.push({ _id: `ins_${inserted.length}`, ...doc });
        return Promise.resolve(`ins_${inserted.length}`);
      }),
    },
  };
  return { ctx, inserted };
}

function sourceTodos(over: Partial<Row> = {}): Row {
  return {
    organizationId: 'org_1',
    threadId: 'src',
    todos: [
      { id: 't1', status: 'done', title: 'a', findingsSummary: 'found x' },
      { id: 't2', status: 'in_progress', title: 'b' },
    ],
    activeTodoId: 't2',
    recentOpIds: ['op_old'],
    integrationCallCount: 7,
    createdAt: 1,
    updatedAt: 2,
    ...over,
  };
}

const args = {
  sourceThreadId: 'src',
  newThreadId: 'fork',
  organizationId: 'org_1',
};

beforeEach(() => vi.clearAllMocks());

describe('copyThreadTodos', () => {
  it('clones todos verbatim, preserving statuses + activeTodoId', async () => {
    const { ctx, inserted } = makeCtx([sourceTodos()]);
    await copyThreadTodos(ctx as never, args);
    expect(inserted).toHaveLength(1);
    const doc = inserted[0].doc;
    expect(doc.threadId).toBe('fork');
    expect(doc.todos).toEqual([
      { id: 't1', status: 'done', title: 'a', findingsSummary: 'found x' },
      { id: 't2', status: 'in_progress', title: 'b' },
    ]);
    expect(doc.activeTodoId).toBe('t2');
  });

  it('resets recentOpIds and integrationCallCount on the fork', async () => {
    const { ctx, inserted } = makeCtx([sourceTodos()]);
    await copyThreadTodos(ctx as never, args);
    expect(inserted[0].doc.recentOpIds).toEqual([]);
    expect(inserted[0].doc.integrationCallCount).toBe(0);
  });

  it('does nothing when the source has no todos doc', async () => {
    const { ctx, inserted } = makeCtx([]);
    await copyThreadTodos(ctx as never, args);
    expect(inserted).toHaveLength(0);
  });

  it('does nothing when the source todos list is empty', async () => {
    const { ctx, inserted } = makeCtx([sourceTodos({ todos: [] })]);
    await copyThreadTodos(ctx as never, args);
    expect(inserted).toHaveLength(0);
  });

  it('is idempotent — does not insert a second doc if the fork already has one', async () => {
    const { ctx, inserted } = makeCtx([
      sourceTodos(),
      sourceTodos({
        threadId: 'fork',
        todos: [{ id: 'x', status: 'pending', title: 'x' }],
      }),
    ]);
    await copyThreadTodos(ctx as never, args);
    expect(inserted).toHaveLength(0);
  });
});
