import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  query: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockIsOrgMember = vi.fn();
vi.mock('../lib/rls/auth/check_org_membership', () => ({
  isOrgMember: (...args: unknown[]) => mockIsOrgMember(...args),
}));

const mockGetDelegateSubThreadIds = vi.fn();
vi.mock('../threads/get_delegate_sub_thread_ids', () => ({
  getDelegateSubThreadIds: (...args: unknown[]) =>
    mockGetDelegateSubThreadIds(...args),
}));

const mockGetBranchAncestorThreadIds = vi.fn();
vi.mock('../threads/get_branch_ancestor_thread_ids', () => ({
  getBranchAncestorThreadIds: (...args: unknown[]) =>
    mockGetBranchAncestorThreadIds(...args),
}));

const { get } = await import('./queries');

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;
const getTodos = get as unknown as Handler;

type Row = Record<string, unknown>;

/** ctx.db with two tables: threadMetadata + threadTodos. withIndex filters by
 * the eq() calls, .first() returns the first match. */
function makeCtx(tables: { threadMetadata: Row[]; threadTodos: Row[] }) {
  const applyIndex = (
    table: keyof typeof tables,
    cb?: (q: unknown) => unknown,
  ) => {
    const rows = tables[table] ?? [];
    if (!cb) return [...rows];
    const eqs: Array<[string, unknown]> = [];
    const q = {
      eq(field: string, value: unknown) {
        eqs.push([field, value]);
        return q;
      },
    };
    cb(q);
    return rows.filter((r) => eqs.every(([f, v]) => r[f] === v));
  };
  return {
    db: {
      query: (table: keyof typeof tables) => ({
        withIndex: (_name: string, cb?: (q: unknown) => unknown) => {
          const rows = applyIndex(table, cb);
          return { first: () => Promise.resolve(rows[0] ?? null) };
        },
      }),
    },
  };
}

function metaRow(over: Partial<Row> = {}): Row {
  return {
    threadId: 'parent',
    userId: 'u_1',
    organizationId: 'org_1',
    isShared: false,
    status: 'active',
    ...over,
  };
}

function todosRow(over: Partial<Row> = {}): Row {
  return {
    threadId: 'parent',
    organizationId: 'org_1',
    todos: [{ id: 't1', status: 'pending', title: 'x' }],
    integrationCallCount: 0,
    updatedAt: 100,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthUserIdentity.mockResolvedValue({ userId: 'u_1' });
  mockIsOrgMember.mockResolvedValue(true);
  mockGetDelegateSubThreadIds.mockResolvedValue([]);
  // Default: a root thread — the chain is just the entry thread.
  mockGetBranchAncestorThreadIds.mockResolvedValue([{ threadId: 'parent' }]);
});

describe('thread_todos.get — delegate sub-thread fallback', () => {
  it('returns the route thread todos when present', async () => {
    const ctx = makeCtx({
      threadMetadata: [metaRow()],
      threadTodos: [todosRow({ threadId: 'parent' })],
    });
    const out = (await getTodos(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as {
      threadId: string;
    } | null;
    expect(out?.threadId).toBe('parent');
    // No fallback needed — sub-threads not consulted.
    expect(mockGetDelegateSubThreadIds).not.toHaveBeenCalled();
  });

  it('falls back to a delegate sub-thread plan when the parent has none', async () => {
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx({
      threadMetadata: [metaRow()],
      threadTodos: [todosRow({ threadId: 'sub', updatedAt: 7 })],
    });
    const out = (await getTodos(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as {
      threadId: string;
      todos: unknown[];
    } | null;
    expect(out?.threadId).toBe('sub');
    expect(out?.todos).toHaveLength(1);
  });

  it('does not merge — parent todos take precedence and the sub-thread is ignored', async () => {
    const ctx = makeCtx({
      threadMetadata: [metaRow()],
      threadTodos: [
        todosRow({ threadId: 'parent', updatedAt: 5 }),
        todosRow({ threadId: 'sub', updatedAt: 999 }),
      ],
    });
    const out = (await getTodos(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as {
      threadId: string;
    } | null;
    expect(out?.threadId).toBe('parent');
    expect(mockGetDelegateSubThreadIds).not.toHaveBeenCalled();
  });

  it('skips an EMPTY parent row and surfaces the delegate sub-thread plan', async () => {
    // Regression: once the parent agent runs its own web/integration calls, a
    // `threadTodos` row materializes on the parent purely to track
    // `integrationCallCount` — with `todos: []`. It must NOT shadow the
    // researcher delegate's real plan (the bug that made the plan pane flash
    // then vanish mid-run).
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx({
      threadMetadata: [metaRow()],
      threadTodos: [
        todosRow({ threadId: 'parent', todos: [], integrationCallCount: 21 }),
        todosRow({ threadId: 'sub', updatedAt: 7 }),
      ],
    });
    const out = (await getTodos(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as {
      threadId: string;
      todos: unknown[];
    } | null;
    expect(out?.threadId).toBe('sub');
    expect(out?.todos).toHaveLength(1);
  });

  it('returns null when the only row (parent) has an empty todos array', async () => {
    // An empty row is not a plan — with no delegate plan either, show nothing
    // rather than an empty pane.
    const ctx = makeCtx({
      threadMetadata: [metaRow()],
      threadTodos: [todosRow({ threadId: 'parent', todos: [] })],
    });
    const out = await getTodos(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    });
    expect(out).toBeNull();
  });

  it('returns null when neither parent nor any sub-thread has todos', async () => {
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx({ threadMetadata: [metaRow()], threadTodos: [] });
    const out = await getTodos(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    });
    expect(out).toBeNull();
  });

  it('returns null (and skips sub-threads) when access is denied', async () => {
    const ctx = makeCtx({
      // Not the owner and not shared → no access.
      threadMetadata: [metaRow({ userId: 'someone_else', isShared: false })],
      threadTodos: [todosRow()],
    });
    const out = await getTodos(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    });
    expect(out).toBeNull();
    expect(mockGetBranchAncestorThreadIds).not.toHaveBeenCalled();
    expect(mockGetDelegateSubThreadIds).not.toHaveBeenCalled();
  });
});

describe('thread_todos.get — branch ancestor lineage', () => {
  it('surfaces the nearest ancestor plan when the branch tip has none', async () => {
    // Viewing branch B (no own todos); parent P has the plan.
    mockGetBranchAncestorThreadIds.mockResolvedValue([
      { threadId: 'B' },
      { threadId: 'P', filesBefore: 100 },
    ]);
    const ctx = makeCtx({
      threadMetadata: [metaRow({ threadId: 'B' })],
      threadTodos: [todosRow({ threadId: 'P' })],
    });
    const out = (await getTodos(ctx, {
      threadId: 'B',
      organizationId: 'org_1',
    })) as {
      threadId: string;
    } | null;
    expect(out?.threadId).toBe('P');
  });

  it('the branch tip plan wins over an ancestor plan', async () => {
    mockGetBranchAncestorThreadIds.mockResolvedValue([
      { threadId: 'B' },
      { threadId: 'P', filesBefore: 100 },
    ]);
    const ctx = makeCtx({
      threadMetadata: [metaRow({ threadId: 'B' })],
      threadTodos: [
        todosRow({ threadId: 'B', updatedAt: 1 }),
        todosRow({ threadId: 'P', updatedAt: 999 }),
      ],
    });
    const out = (await getTodos(ctx, {
      threadId: 'B',
      organizationId: 'org_1',
    })) as {
      threadId: string;
    } | null;
    expect(out?.threadId).toBe('B');
  });

  it("falls back to an ancestor's delegate sub-thread plan", async () => {
    mockGetBranchAncestorThreadIds.mockResolvedValue([
      { threadId: 'B' },
      { threadId: 'P' },
    ]);
    mockGetDelegateSubThreadIds.mockImplementation((_ctx, threadId: string) =>
      Promise.resolve(threadId === 'P' ? ['P_sub'] : []),
    );
    const ctx = makeCtx({
      threadMetadata: [metaRow({ threadId: 'B' })],
      threadTodos: [todosRow({ threadId: 'P_sub' })],
    });
    const out = (await getTodos(ctx, {
      threadId: 'B',
      organizationId: 'org_1',
    })) as {
      threadId: string;
    } | null;
    expect(out?.threadId).toBe('P_sub');
  });
});

describe('thread_todos.get — active-org coherence', () => {
  it("returns null when organizationId is not the thread's active org", async () => {
    // A todos plan carried over from another org (stale URL / warm cache) must
    // resolve to null rather than the other org's plan — even though the caller
    // owns the thread and belongs to its org. Mirrors the by-id guard the rest
    // of the active-org work applies (see assert_active_org).
    const ctx = makeCtx({
      threadMetadata: [metaRow()],
      threadTodos: [todosRow({ threadId: 'parent' })],
    });
    const out = await getTodos(ctx, {
      threadId: 'parent',
      organizationId: 'org_other',
    });
    expect(out).toBeNull();
  });
});
