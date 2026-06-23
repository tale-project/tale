import { beforeEach, describe, expect, it, vi } from 'vitest';

// Export raw handlers so we can drive them with a mocked ctx (same pattern as
// approvals/plan_mutations.test.ts).
vi.mock('../_generated/server', () => ({
  query: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockCanAccessThread = vi.fn();
vi.mock('../lib/rls/auth/can_access_thread', () => ({
  canAccessThread: (...args: unknown[]) => mockCanAccessThread(...args),
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

vi.mock('../lib/helpers/public_storage_url', () => ({
  toPublicUrl: (u: string) => u,
}));

const { listThreadFilesForUser, getThreadFileContentUrl } =
  await import('./queries');

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;
const listFiles = listThreadFilesForUser as unknown as Handler;
const getUrl = getThreadFileContentUrl as unknown as Handler;

type Row = Record<string, unknown>;

/** In-memory ctx.db supporting withIndex → order/collect/asyncIterator/first,
 * filtering by the eq() calls the index callback makes. */
function makeCtx(threadFiles: Row[], storageUrls: Record<string, string> = {}) {
  const applyIndex = (cb?: (q: unknown) => unknown): Row[] => {
    if (!cb) return [...threadFiles];
    const eqs: Array<[string, unknown]> = [];
    const q = {
      eq(field: string, value: unknown) {
        eqs.push([field, value]);
        return q;
      },
    };
    cb(q);
    return threadFiles.filter((r) => eqs.every(([f, v]) => r[f] === v));
  };
  return {
    db: {
      query: () => ({
        withIndex: (_name: string, cb?: (q: unknown) => unknown) => {
          const rows = applyIndex(cb);
          const result = {
            order: () => result,
            collect: () => Promise.resolve([...rows]),
            first: () => Promise.resolve(rows[0] ?? null),
            [Symbol.asyncIterator]: async function* () {
              yield* rows;
            },
          };
          return result;
        },
      }),
    },
    storage: {
      getUrl: (storageId: string) =>
        Promise.resolve(storageUrls[storageId] ?? null),
    },
  };
}

function fileRow(over: Partial<Row> = {}): Row {
  return {
    threadId: 'parent',
    organizationId: 'org_1',
    path: 'a.md',
    size: 10,
    contentType: 'text/markdown',
    source: 'agent_write',
    storageId: 'st_a',
    updatedAt: 100,
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthUserIdentity.mockResolvedValue({ userId: 'u_1' });
  mockCanAccessThread.mockResolvedValue({ organizationId: 'org_1' });
  mockGetDelegateSubThreadIds.mockResolvedValue([]);
  // Default: a root thread — the chain is just the entry thread, no fork cut.
  mockGetBranchAncestorThreadIds.mockResolvedValue([{ threadId: 'parent' }]);
});

describe('listThreadFilesForUser — delegate sub-thread union', () => {
  it('returns parent-thread files when there are no sub-threads', async () => {
    const ctx = makeCtx([fileRow({ path: 'a.md', threadId: 'parent' })]);
    const out = (await listFiles(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as Array<{ path: string }>;
    expect(out.map((f) => f.path)).toEqual(['a.md']);
  });

  it('surfaces files written on a delegate sub-thread', async () => {
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx([
      fileRow({ path: 'plan.md', threadId: 'sub', updatedAt: 50 }),
    ]);
    const out = (await listFiles(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as Array<{ path: string }>;
    expect(out.map((f) => f.path)).toEqual(['plan.md']);
  });

  it('on a path collision the route-thread file wins (parent precedence)', async () => {
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx([
      fileRow({
        path: 'plan.md',
        threadId: 'parent',
        size: 999,
        updatedAt: 80,
      }),
      fileRow({ path: 'plan.md', threadId: 'sub', size: 1, updatedAt: 200 }),
    ]);
    const out = (await listFiles(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as Array<{ path: string; size: number }>;
    expect(out).toHaveLength(1);
    expect(out[0].size).toBe(999); // parent copy, not the newer sub-thread one
  });

  it('filters out cross-org rows on a sub-thread', async () => {
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx([
      fileRow({ path: 'leak.md', threadId: 'sub', organizationId: 'other' }),
    ]);
    const out = (await listFiles(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as Array<unknown>;
    expect(out).toEqual([]);
  });

  it('returns [] when the caller cannot access the thread', async () => {
    mockCanAccessThread.mockResolvedValue(null);
    const ctx = makeCtx([fileRow()]);
    const out = await listFiles(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    });
    expect(out).toEqual([]);
    // Must not even look at the lineage / sub-threads when access is denied.
    expect(mockGetBranchAncestorThreadIds).not.toHaveBeenCalled();
    expect(mockGetDelegateSubThreadIds).not.toHaveBeenCalled();
  });

  it('results are sorted newest-first across the union', async () => {
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx([
      fileRow({ path: 'old.md', threadId: 'parent', updatedAt: 10 }),
      fileRow({ path: 'new.md', threadId: 'sub', updatedAt: 999 }),
    ]);
    const out = (await listFiles(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
    })) as Array<{ path: string }>;
    expect(out.map((f) => f.path)).toEqual(['new.md', 'old.md']);
  });
});

describe('listThreadFilesForUser — branch fork-point cut', () => {
  it("cuts an ancestor's files touched after the fork point", async () => {
    // Viewing branch B (tip, no cut), ancestor P cut at updatedAt <= 100.
    mockGetBranchAncestorThreadIds.mockResolvedValue([
      { threadId: 'B' },
      { threadId: 'P', filesBefore: 100 },
    ]);
    const ctx = makeCtx([
      fileRow({ path: 'early.md', threadId: 'P', updatedAt: 50 }),
      fileRow({ path: 'late.md', threadId: 'P', updatedAt: 150 }),
    ]);
    const out = (await listFiles(ctx, {
      threadId: 'B',
      organizationId: 'org_1',
    })) as Array<{ path: string }>;
    // early.md (<= 100) carries over; late.md (> 100, post-fork) is excluded.
    expect(out.map((f) => f.path)).toEqual(['early.md']);
  });

  it('cuts a pre-fork file that was edited after the fork (old createdAt, new updatedAt)', async () => {
    // The file was first written before the fork (createdAt 10) but rewritten
    // after the branch split (updatedAt 150). upsertThreadFile preserves the
    // old createdAt, so a createdAt-based cut would leak the later content into
    // the branch; the updatedAt-based cut correctly excludes it.
    mockGetBranchAncestorThreadIds.mockResolvedValue([
      { threadId: 'B' },
      { threadId: 'P', filesBefore: 100 },
    ]);
    const ctx = makeCtx([
      fileRow({
        path: 'edited.md',
        threadId: 'P',
        createdAt: 10,
        updatedAt: 150,
      }),
    ]);
    const out = (await listFiles(ctx, {
      threadId: 'B',
      organizationId: 'org_1',
    })) as Array<unknown>;
    expect(out).toEqual([]);
  });

  it('does not cut the active tip — its own later files always show', async () => {
    mockGetBranchAncestorThreadIds.mockResolvedValue([
      { threadId: 'B' },
      { threadId: 'P', filesBefore: 100 },
    ]);
    const ctx = makeCtx([
      fileRow({ path: 'tip-late.md', threadId: 'B', updatedAt: 999 }),
    ]);
    const out = (await listFiles(ctx, {
      threadId: 'B',
      organizationId: 'org_1',
    })) as Array<{ path: string }>;
    expect(out.map((f) => f.path)).toEqual(['tip-late.md']);
  });

  it("applies the ancestor cut to that ancestor's delegate sub-thread files", async () => {
    mockGetBranchAncestorThreadIds.mockResolvedValue([
      { threadId: 'B' },
      { threadId: 'P', filesBefore: 100 },
    ]);
    // P has a delegate sub-thread 'P_sub' with a post-fork file.
    mockGetDelegateSubThreadIds.mockImplementation((_ctx, threadId: string) =>
      Promise.resolve(threadId === 'P' ? ['P_sub'] : []),
    );
    const ctx = makeCtx([
      fileRow({ path: 'sub-late.md', threadId: 'P_sub', updatedAt: 150 }),
    ]);
    const out = (await listFiles(ctx, {
      threadId: 'B',
      organizationId: 'org_1',
    })) as Array<unknown>;
    expect(out).toEqual([]); // delegate file is post-fork → cut too
  });
});

describe('getThreadFileContentUrl — sub-thread path resolution', () => {
  it('resolves a path that only exists on a delegate sub-thread', async () => {
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx(
      [fileRow({ path: 'plan.md', threadId: 'sub', storageId: 'st_plan' })],
      { st_plan: 'https://files/plan' },
    );
    const out = (await getUrl(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
      path: 'plan.md',
    })) as { url: string } | null;
    expect(out?.url).toBe('https://files/plan');
  });

  it('prefers the route-thread copy over a sub-thread copy at the same path', async () => {
    mockGetDelegateSubThreadIds.mockResolvedValue(['sub']);
    const ctx = makeCtx(
      [
        fileRow({
          path: 'plan.md',
          threadId: 'parent',
          storageId: 'st_parent',
        }),
        fileRow({ path: 'plan.md', threadId: 'sub', storageId: 'st_sub' }),
      ],
      { st_parent: 'https://files/parent', st_sub: 'https://files/sub' },
    );
    const out = (await getUrl(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
      path: 'plan.md',
    })) as { url: string } | null;
    expect(out?.url).toBe('https://files/parent');
  });

  it('returns null when access is denied', async () => {
    mockCanAccessThread.mockResolvedValue(null);
    const ctx = makeCtx([fileRow()]);
    const out = await getUrl(ctx, {
      threadId: 'parent',
      organizationId: 'org_1',
      path: 'a.md',
    });
    expect(out).toBeNull();
    expect(mockGetBranchAncestorThreadIds).not.toHaveBeenCalled();
    expect(mockGetDelegateSubThreadIds).not.toHaveBeenCalled();
  });

  it("won't open an ancestor file that was cut off at the fork point", async () => {
    mockGetBranchAncestorThreadIds.mockResolvedValue([
      { threadId: 'B' },
      { threadId: 'P', filesBefore: 100 },
    ]);
    const ctx = makeCtx(
      [
        fileRow({
          path: 'late.md',
          threadId: 'P',
          updatedAt: 150,
          storageId: 'st_late',
        }),
      ],
      { st_late: 'https://files/late' },
    );
    const out = await getUrl(ctx, {
      threadId: 'B',
      organizationId: 'org_1',
      path: 'late.md',
    });
    // Post-fork ancestor file is hidden from the list, so it must not open either.
    expect(out).toBeNull();
  });
});
