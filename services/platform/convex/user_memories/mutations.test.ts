import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/api', () => ({
  internal: {
    user_memory_audit_log: {
      internal_mutations: {
        appendAudit: 'appendAudit',
      },
    },
  },
}));

vi.mock('../_generated/server', () => ({
  mutation: (config: Record<string, unknown>) => config,
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
    },
    ConvexError: class ConvexError extends Error {
      data: unknown;
      constructor(data: unknown) {
        super(typeof data === 'string' ? data : 'ConvexError');
        this.data = data;
      }
    },
  };
});

vi.mock('./lazy_cleanup', () => ({
  maybeRunCleanup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/rls/auth/require_authenticated_user', () => ({
  requireAuthenticatedUser: vi
    .fn()
    .mockResolvedValue({ userId: 'u_1', email: 'u_1@example.com' }),
}));

vi.mock('../lib/rls/auth/assert_self_and_org_member', () => ({
  assertSelfAndOrgMember: vi.fn().mockResolvedValue(undefined),
}));

const evaluateGates = vi.fn();
vi.mock('../personalization/internal_queries', () => ({
  evaluatePersonalizationGates: (...args: unknown[]): Promise<boolean> =>
    evaluateGates(...args),
}));

interface FakeMemoryRow {
  _id: string;
  userId: string;
  organizationId: string;
  content: string;
  source: 'manual' | 'agent_proposed';
  status: 'pending' | 'approved';
  pendingExpiresAt?: number;
  deletedAt?: number;
  createdAt: number;
}

function createMockCtx({ row }: { row?: FakeMemoryRow }) {
  const inserted: FakeMemoryRow[] = [];
  const patches: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  let currentRow = row;

  const ctx = {
    runMutation: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      auditCalls.push(args);
    }),
    db: {
      get: vi.fn(async (_id: string) => currentRow ?? null),
      insert: vi.fn(async (_table: string, doc: FakeMemoryRow) => {
        const id = `mem_${inserted.length + 1}`;
        inserted.push({ ...doc, _id: id });
        return id;
      }),
      patch: vi.fn(async (id: string, payload: Record<string, unknown>) => {
        patches.push({ id, payload });
        if (currentRow && currentRow._id === id) {
          currentRow = { ...currentRow, ...payload } as FakeMemoryRow;
        }
      }),
      delete: vi.fn(async (id: string) => {
        deletes.push(id);
        if (currentRow && currentRow._id === id) {
          currentRow = undefined;
        }
      }),
    },
  };

  return { ctx, inserted, patches, deletes, auditCalls };
}

async function getHandlers() {
  const mod = await import('./mutations');
  type WithHandler = { handler: (...args: unknown[]) => Promise<unknown> };
  return {
    addMemory: (mod.addMemory as unknown as WithHandler).handler,
    approvePendingMemory: (mod.approvePendingMemory as unknown as WithHandler)
      .handler,
    dismissPendingMemory: (mod.dismissPendingMemory as unknown as WithHandler)
      .handler,
    softDeleteMemory: (mod.softDeleteMemory as unknown as WithHandler).handler,
  };
}

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('addMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateGates.mockReset();
  });

  it('throws forbidden + audits denied when personalization gate is closed', async () => {
    evaluateGates.mockResolvedValue(false);
    const { ctx, inserted, auditCalls } = createMockCtx({});
    const { addMemory } = await getHandlers();

    await expect(
      addMemory(ctx, { organizationId: 'o_1', content: 'loves chess' }),
    ).rejects.toMatchObject({ data: { code: 'forbidden' } });

    expect(inserted).toHaveLength(0);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: 'create',
      outcome: 'denied',
      actorUserId: 'u_1',
      subjectUserId: 'u_1',
    });
  });

  it('inserts approved row + audits ok when gate is open', async () => {
    evaluateGates.mockResolvedValue(true);
    const { ctx, inserted, auditCalls } = createMockCtx({});
    const { addMemory } = await getHandlers();

    const id = await addMemory(ctx, {
      organizationId: 'o_1',
      content: 'loves chess',
    });

    expect(id).toBe('mem_1');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: 'u_1',
      organizationId: 'o_1',
      content: 'loves chess',
      source: 'manual',
      status: 'approved',
    });
    expect(auditCalls[0]).toMatchObject({
      action: 'create',
      outcome: 'ok',
      memoryId: 'mem_1',
    });
  });
});

describe('approvePendingMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  function pendingRow(overrides: Partial<FakeMemoryRow> = {}): FakeMemoryRow {
    return {
      _id: 'mem_target',
      userId: 'u_1',
      organizationId: 'o_1',
      content: 'lives in PT',
      source: 'agent_proposed',
      status: 'pending',
      pendingExpiresAt: NOW + 12 * HOUR,
      createdAt: NOW - HOUR,
      ...overrides,
    };
  }

  it('approves a fresh pending row → status=approved, content unchanged, pendingExpiresAt cleared', async () => {
    const { ctx, patches, auditCalls } = createMockCtx({ row: pendingRow() });
    const { approvePendingMemory } = await getHandlers();

    await approvePendingMemory(ctx, { memoryId: 'mem_target' });

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      id: 'mem_target',
      payload: {
        status: 'approved',
        content: 'lives in PT',
        pendingExpiresAt: undefined,
      },
    });
    expect(auditCalls[0]).toMatchObject({ action: 'approve', outcome: 'ok' });
  });

  it('approves with content edit → trims and stores trimmed value', async () => {
    const { ctx, patches } = createMockCtx({ row: pendingRow() });
    const { approvePendingMemory } = await getHandlers();

    await approvePendingMemory(ctx, {
      memoryId: 'mem_target',
      content: '   lives in NYC   ',
    });

    expect(patches[0].payload.content).toBe('lives in NYC');
  });

  it('rejects whitespace-only content edit (empty after trim)', async () => {
    const { ctx, patches, auditCalls } = createMockCtx({ row: pendingRow() });
    const { approvePendingMemory } = await getHandlers();

    await expect(
      approvePendingMemory(ctx, {
        memoryId: 'mem_target',
        content: '     ',
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid' } });

    expect(patches).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });

  it('rejects when pendingExpiresAt has elapsed', async () => {
    const { ctx, patches } = createMockCtx({
      row: pendingRow({ pendingExpiresAt: NOW - 1 }),
    });
    const { approvePendingMemory } = await getHandlers();

    await expect(
      approvePendingMemory(ctx, { memoryId: 'mem_target' }),
    ).rejects.toMatchObject({ data: { code: 'invalid' } });
    expect(patches).toHaveLength(0);
  });

  it('rejects a soft-deleted pending row (deletedAt set)', async () => {
    const { ctx, patches } = createMockCtx({
      row: pendingRow({ deletedAt: NOW - HOUR }),
    });
    const { approvePendingMemory } = await getHandlers();

    await expect(
      approvePendingMemory(ctx, { memoryId: 'mem_target' }),
    ).rejects.toMatchObject({ data: { code: 'invalid' } });
    expect(patches).toHaveLength(0);
  });

  it('rejects a non-pending row', async () => {
    const { ctx } = createMockCtx({
      row: pendingRow({ status: 'approved', pendingExpiresAt: undefined }),
    });
    const { approvePendingMemory } = await getHandlers();

    await expect(
      approvePendingMemory(ctx, { memoryId: 'mem_target' }),
    ).rejects.toMatchObject({ data: { code: 'invalid' } });
  });

  it('throws forbidden when memory belongs to a different user', async () => {
    const { ctx } = createMockCtx({
      row: pendingRow({ userId: 'u_other' }),
    });
    const { approvePendingMemory } = await getHandlers();

    await expect(
      approvePendingMemory(ctx, { memoryId: 'mem_target' }),
    ).rejects.toMatchObject({ data: { code: 'forbidden' } });
  });
});

describe('dismissPendingMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function pendingRow(overrides: Partial<FakeMemoryRow> = {}): FakeMemoryRow {
    return {
      _id: 'mem_target',
      userId: 'u_1',
      organizationId: 'o_1',
      content: 'lives in PT',
      source: 'agent_proposed',
      status: 'pending',
      pendingExpiresAt: Date.now() + 12 * HOUR,
      createdAt: Date.now() - HOUR,
      ...overrides,
    };
  }

  it('hard-deletes the pending row and writes a dismiss audit row', async () => {
    const { ctx, deletes, patches, auditCalls } = createMockCtx({
      row: pendingRow(),
    });
    const { dismissPendingMemory } = await getHandlers();

    await dismissPendingMemory(ctx, { memoryId: 'mem_target' });

    expect(deletes).toEqual(['mem_target']);
    expect(patches).toHaveLength(0);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: 'dismiss',
      outcome: 'ok',
      memoryId: 'mem_target',
    });
  });

  it('rejects non-pending rows', async () => {
    const { ctx, deletes } = createMockCtx({
      row: pendingRow({ status: 'approved' }),
    });
    const { dismissPendingMemory } = await getHandlers();

    await expect(
      dismissPendingMemory(ctx, { memoryId: 'mem_target' }),
    ).rejects.toMatchObject({ data: { code: 'invalid' } });
    expect(deletes).toHaveLength(0);
  });

  it('throws forbidden when memory belongs to a different user', async () => {
    const { ctx, deletes } = createMockCtx({
      row: pendingRow({ userId: 'u_other' }),
    });
    const { dismissPendingMemory } = await getHandlers();

    await expect(
      dismissPendingMemory(ctx, { memoryId: 'mem_target' }),
    ).rejects.toMatchObject({ data: { code: 'forbidden' } });
    expect(deletes).toHaveLength(0);
  });
});
