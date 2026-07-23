import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSaveMessage = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
}));

vi.mock('../_generated/api', () => ({
  components: {
    agent: { messages: { deleteByIds: 'mock-deleteByIds' } },
  },
  internal: {
    agents: {
      chat_turn_generate: { runChatTurnGeneration: 'mock-runChatTurn' },
    },
    node_only: {
      sandbox: { steer_delivery: { deliverSteerMessages: 'mock-deliver' } },
    },
  },
}));

vi.mock('../_generated/server', () => ({
  mutation: ({ handler }: { handler: Function }) => handler,
  internalMutation: ({ handler }: { handler: Function }) => handler,
  query: ({ handler }: { handler: Function }) => handler,
  internalQuery: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockCanAccessThread = vi.fn();
vi.mock('../lib/rls/auth/can_access_thread', () => ({
  canAccessThread: (...args: unknown[]) => mockCanAccessThread(...args),
}));

const mockCreateStream = vi.fn();
vi.mock('../streaming/helpers', () => ({
  persistentStreaming: {
    createStream: (...args: unknown[]) => mockCreateStream(...args),
  },
}));

const { approvePlan, rejectPlan } = await import('./plan_mutations');
const { createPlanApproval } = await import('./internal_mutations');

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;
const approve = approvePlan as unknown as Handler;
const reject = rejectPlan as unknown as Handler;
const createPlan = createPlanApproval as unknown as Handler;

type Row = Record<string, unknown> & { _id: string };

/** Tiny in-memory convex db (same shape as message_queue.test.ts): filters by
 * the eq() calls the index callback makes; insert/patch/get/delete mutate the
 * tables in place so later reads inside one call see prior writes. */
function makeCtx(tables: Record<string, Row[]>) {
  let insertSeq = 0;
  const applyIndex = (rows: Row[], cb?: (q: unknown) => unknown): Row[] => {
    if (!cb) return rows;
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
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_name: string, cb?: (q: unknown) => unknown) => {
          const rows = applyIndex(tables[table] ?? [], cb);
          return {
            collect: () => Promise.resolve([...rows]),
            first: () => Promise.resolve(rows[0] ?? null),
            [Symbol.asyncIterator]: function* () {
              yield* rows;
            } as unknown as () => AsyncIterator<Row>,
          };
        },
      }),
      insert: vi.fn((table: string, doc: Record<string, unknown>) => {
        insertSeq += 1;
        const row: Row = {
          _id: `ins_${insertSeq}`,
          _creationTime: insertSeq,
          ...doc,
        };
        (tables[table] ??= []).push(row);
        return Promise.resolve(row._id);
      }),
      patch: vi.fn((id: string, patch: Record<string, unknown>) => {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) Object.assign(row, patch);
        }
        return Promise.resolve();
      }),
      get: vi.fn((id: string) => {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) return Promise.resolve(row);
        }
        return Promise.resolve(null);
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
    runMutation: vi.fn().mockResolvedValue(undefined),
  };
  return ctx;
}

function planApprovalRow(over: Partial<Row> = {}): Row {
  return {
    _id: 'appr_1',
    _creationTime: 10,
    organizationId: 'org_1',
    status: 'pending',
    resourceType: 'external_agent_plan',
    resourceId: 'thread_1',
    threadId: 'thread_1',
    messageId: 'msg_src',
    priority: 'medium',
    metadata: {
      plan: '# Plan',
      planSource: 'exit_plan_mode',
      agentSlug: 'claude-code',
      modelRef: 'openrouter:anthropic/claude-haiku-4.5',
      requestedAt: 1,
    },
    ...over,
  };
}

function metaRow(over: Partial<Row> = {}): Row {
  return {
    _id: 'meta_1',
    threadId: 'thread_1',
    userId: 'user_1',
    externalAgentMode: 'plan',
    ...over,
  };
}

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    expect.unreachable(`expected ConvexError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<{ code: string }>).data.code).toBe(code);
  }
}

describe('approvePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user_1',
      email: 'u@example.com',
      name: 'U',
    });
    mockSaveMessage.mockResolvedValue({ messageId: 'msg_approved' });
    mockCreateStream.mockResolvedValue('stream_1');
  });

  it('fails offline after its guards, leaving the approval pending', async () => {
    const meta = metaRow();
    const approval = planApprovalRow();
    const tables: Record<string, Row[]> = {
      approvals: [approval],
      threadMetadata: [meta],
      chatMessageQueue: [],
    };
    const ctx = makeCtx(tables);
    mockCanAccessThread.mockResolvedValue(meta);

    // Executing an approved plan re-enters the chat pipeline, which is
    // offline while it is rebuilt: the ownership/resolution guards still run,
    // then the mutation refuses without resolving the card or queuing a turn.
    await expect(
      approve(ctx, { approvalId: 'appr_1', organizationId: 'org_1' }),
    ).rejects.toThrow(/offline while the platform AI backend is rewritten/i);

    expect(approval.status).toBe('pending');
    expect(meta.externalAgentMode).not.toBe('act');
    expect(meta.generationStatus).not.toBe('generating');
    expect(tables.chatMessageQueue).toHaveLength(0);
  });

  it('fails offline (not TURN_RUNNING) while the thread is generating', async () => {
    // The TURN_RUNNING race guard lived in the plan-execution path, which is
    // offline while chat is rebuilt; a generating thread now reaches the
    // offline error and the approval stays pending either way.
    const meta = metaRow({ generationStatus: 'generating' });
    const approval = planApprovalRow();
    const ctx = makeCtx({
      approvals: [approval],
      threadMetadata: [meta],
      chatMessageQueue: [],
    });
    mockCanAccessThread.mockResolvedValue(meta);

    await expect(
      approve(ctx, { approvalId: 'appr_1', organizationId: 'org_1' }),
    ).rejects.toThrow(/offline while the platform AI backend is rewritten/i);
    expect(approval.status).toBe('pending');
  });

  it('rejects with ALREADY_RESOLVED on a second click', async () => {
    const meta = metaRow();
    const approval = planApprovalRow({ status: 'completed' });
    const ctx = makeCtx({
      approvals: [approval],
      threadMetadata: [meta],
      chatMessageQueue: [],
    });
    mockCanAccessThread.mockResolvedValue(meta);

    await expectCode(
      approve(ctx, { approvalId: 'appr_1', organizationId: 'org_1' }),
      'ALREADY_RESOLVED',
    );
  });

  it('rejects with NOT_FOUND for a non-owner', async () => {
    const meta = metaRow({ userId: 'someone_else' });
    const ctx = makeCtx({
      approvals: [planApprovalRow()],
      threadMetadata: [meta],
      chatMessageQueue: [],
    });
    mockCanAccessThread.mockResolvedValue(meta);

    await expectCode(
      approve(ctx, { approvalId: 'appr_1', organizationId: 'org_1' }),
      'NOT_FOUND',
    );
  });
});

describe('rejectPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
  });

  it('marks the card rejected and leaves the thread in plan mode', async () => {
    const meta = metaRow();
    const approval = planApprovalRow();
    const ctx = makeCtx({
      approvals: [approval],
      threadMetadata: [meta],
      chatMessageQueue: [],
    });
    mockCanAccessThread.mockResolvedValue(meta);

    await reject(ctx, { approvalId: 'appr_1', organizationId: 'org_1' });

    expect(approval.status).toBe('rejected');
    expect(meta.externalAgentMode).toBe('plan');
    expect(meta.generationStatus).toBeUndefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('rejects with ALREADY_RESOLVED when not pending', async () => {
    const meta = metaRow();
    const ctx = makeCtx({
      approvals: [planApprovalRow({ status: 'rejected' })],
      threadMetadata: [meta],
      chatMessageQueue: [],
    });
    mockCanAccessThread.mockResolvedValue(meta);

    await expectCode(
      reject(ctx, { approvalId: 'appr_1', organizationId: 'org_1' }),
      'ALREADY_RESOLVED',
    );
  });
});

describe('createPlanApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const args = {
    organizationId: 'org_1',
    threadId: 'thread_1',
    messageId: 'msg_new',
    agentSlug: 'claude-code',
    modelRef: 'openrouter:anthropic/claude-haiku-4.5',
    plan: '# Newer plan',
    planSource: 'exit_plan_mode',
  };

  it('supersedes older pending plans and flips the thread to plan mode', async () => {
    const old = planApprovalRow();
    const meta = metaRow({ externalAgentMode: 'act' });
    const tables: Record<string, Row[]> = {
      approvals: [old],
      threadMetadata: [meta],
    };
    const ctx = makeCtx(tables);

    const newId = await createPlan(ctx, args);

    expect(old.status).toBe('rejected');
    expect((old.metadata as { supersededBy?: string }).supersededBy).toBe(
      newId,
    );
    const inserted = tables.approvals?.find((r) => r._id === newId);
    expect(inserted).toMatchObject({
      status: 'pending',
      resourceType: 'external_agent_plan',
      threadId: 'thread_1',
      messageId: 'msg_new',
    });
    // Agent-initiated plan (act-mode turn) leaves the composer toggle
    // reflecting reality.
    expect(meta.externalAgentMode).toBe('plan');
  });

  it('is idempotent on the mode flip for a turn that already ran in plan mode', async () => {
    const meta = metaRow({ externalAgentMode: 'plan' });
    const ctx = makeCtx({ approvals: [], threadMetadata: [meta] });

    await createPlan(ctx, args);

    const metaPatches = ctx.db.patch.mock.calls.filter(
      ([id]) => id === 'meta_1',
    );
    expect(metaPatches).toHaveLength(0);
  });
});
