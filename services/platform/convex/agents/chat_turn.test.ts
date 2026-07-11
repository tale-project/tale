import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `chatWithAgentTurn`'s thread-access gate. The load-bearing case: a
 * NON-OWNER org member must pass the gate on an `automation_discussion` thread (the
 * AgentChat block's shared per-subject surface) — the pre-existing owner-only
 * check blocked every non-owner. The gate's non-owner branch runs the REAL
 * `assertThreadAccess`/`canAccessThread` (not a mock): membership resolves
 * from a seeded `memberMirror` row; a missing row falls through to the
 * mocked-empty Better Auth pages ⇒ denial.
 */

vi.mock('../_generated/api', () => ({
  components: {
    agent: { threads: { getThread: 'agent:threads:getThread' } },
    betterAuth: { adapter: { findMany: 'betterAuth:adapter:findMany' } },
  },
  internal: {
    agents: {
      chat_turn_generate: { runChatTurnGeneration: 'mock-runChatTurn' },
      internal_mutations: { recordRouteOverride: 'mock-recordRouteOverride' },
    },
    projects: {
      internal_queries: { assertProjectAccessForChat: 'mock-projectAccess' },
    },
  },
}));

// Identity factory so registered functions expose their raw config — lets
// tests call handlers directly (same pattern as message_queue.test.ts).
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
    query: (config: Record<string, unknown>) => config,
    internalMutation: (config: Record<string, unknown>) => config,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockCreateStream = vi.fn();
vi.mock('../streaming/helpers', () => ({
  persistentStreaming: {
    createStream: (...args: unknown[]) => mockCreateStream(...args),
  },
}));

vi.mock('../control/drain', () => ({
  isDrainingNow: vi.fn().mockResolvedValue(false),
}));

const mockCancelGeneration = vi.fn();
vi.mock('../threads/cancel_generation', () => ({
  cancelGeneration: (...args: unknown[]) => mockCancelGeneration(...args),
}));

const { chatWithAgentTurn } = await import('./chat_turn');

interface TurnArgs {
  agentSlug: string;
  threadId: string;
  organizationId: string;
  message: string;
  attachments?: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }>;
}

const turnHandler = (
  chatWithAgentTurn as unknown as {
    handler: (
      ctx: unknown,
      args: TurnArgs,
    ) => Promise<{ messageAlreadyExists: boolean; streamId: string }>;
  }
).handler;

type Row = Record<string, unknown> & { _id: string };

/** Tiny in-memory convex db (index-eq filtering + in-place patch), plus the
 * scheduler/runQuery/runMutation surface the turn mutation touches. */
function makeCtx(tables: Record<string, Row[]>) {
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
            first: () => Promise.resolve(rows[0] ?? null),
            collect: () => Promise.resolve([...rows]),
          };
        },
      }),
      patch: vi.fn((id: string, patch: Record<string, unknown>) => {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) Object.assign(row, patch);
        }
        return Promise.resolve();
      }),
      get: vi.fn(),
    },
    scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
    // Better Auth fallback (memberMirror miss): empty pages ⇒ non-member.
    runQuery: vi
      .fn()
      .mockResolvedValue({ page: [], isDone: true, continueCursor: '' }),
    runMutation: vi.fn().mockResolvedValue(undefined),
    auth: {},
  };
  return ctx;
}

function appThreadMeta(over: Partial<Row> = {}): Row {
  return {
    _id: 'tm_1',
    threadId: 't_app',
    userId: 'user_owner',
    organizationId: 'org_1',
    status: 'active',
    kind: 'automation_discussion',
    ...over,
  };
}

function memberMirrorRow(userId: string, organizationId = 'org_1'): Row {
  return {
    _id: `mm_${userId}`,
    memberId: `member_${userId}`,
    organizationId,
    userId,
    role: 'member',
    createdAt: 1,
  };
}

const baseArgs: TurnArgs = {
  agentSlug: 'assistant',
  threadId: 't_app',
  organizationId: 'org_1',
  message: 'hello',
};

describe('chatWithAgentTurn — thread-access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user_member',
      email: 'member@example.com',
      name: 'Member',
    });
    mockCreateStream.mockResolvedValue('stream_1');
  });

  it('lets a NON-OWNER org member start a turn on an automation_discussion thread', async () => {
    const tables: Record<string, Row[]> = {
      threadMetadata: [appThreadMeta()],
      memberMirror: [memberMirrorRow('user_member')],
    };
    const ctx = makeCtx(tables);

    const result = await turnHandler(ctx, baseArgs);

    expect(result).toEqual({
      messageAlreadyExists: false,
      streamId: 'stream_1',
      unresolvedMentionTokens: [],
    });
    // The gate passed: the thread was marked generating and the node action
    // was scheduled with the NON-OWNER as the acting user.
    expect(tables.threadMetadata?.[0]?.generationStatus).toBe('generating');
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'mock-runChatTurn',
      expect.objectContaining({ userId: 'user_member', threadId: 't_app' }),
    );
  });

  it('still denies a non-owner on a plain chat thread (owner-only)', async () => {
    const tables: Record<string, Row[]> = {
      threadMetadata: [appThreadMeta({ kind: undefined })],
      memberMirror: [memberMirrorRow('user_member')],
    };
    const ctx = makeCtx(tables);

    await expect(turnHandler(ctx, baseArgs)).rejects.toThrow(
      'Thread not found',
    );
    expect(tables.threadMetadata?.[0]?.generationStatus).toBeUndefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('denies a NON-MEMBER on an automation_discussion thread', async () => {
    // No memberMirror row and empty Better Auth pages: assertThreadAccess
    // throws forbidden before any state is committed.
    const tables: Record<string, Row[]> = {
      threadMetadata: [appThreadMeta()],
      memberMirror: [],
    };
    const ctx = makeCtx(tables);

    await expect(turnHandler(ctx, baseArgs)).rejects.toMatchObject({
      data: { code: 'forbidden' },
    });
    expect(tables.threadMetadata?.[0]?.generationStatus).toBeUndefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('denies a member acting in a different org (coherence boundary)', async () => {
    // Member of BOTH orgs, but the send names org_2 while the thread lives in
    // org_1 — assertThreadAccess's active-org hint must deny.
    const tables: Record<string, Row[]> = {
      threadMetadata: [appThreadMeta()],
      memberMirror: [
        memberMirrorRow('user_member', 'org_1'),
        memberMirrorRow('user_member', 'org_2'),
      ],
    };
    const ctx = makeCtx(tables);

    await expect(
      turnHandler(ctx, { ...baseArgs, organizationId: 'org_2' }),
    ).rejects.toMatchObject({ data: { code: 'forbidden' } });
  });

  it('keeps the owner path working on a plain chat thread', async () => {
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user_owner',
      email: 'owner@example.com',
      name: 'Owner',
    });
    const tables: Record<string, Row[]> = {
      threadMetadata: [appThreadMeta({ kind: undefined })],
      memberMirror: [],
    };
    const ctx = makeCtx(tables);

    const result = await turnHandler(ctx, baseArgs);

    expect(result.streamId).toBe('stream_1');
    expect(tables.threadMetadata?.[0]?.generationStatus).toBe('generating');
  });

  it('supersedes an in-flight turn AS THE OWNER when a non-owner sends', async () => {
    // cancelGeneration validates against the component thread's creator
    // (== meta.userId); the supersede must pass the owner id, not the sender.
    const tables: Record<string, Row[]> = {
      threadMetadata: [
        appThreadMeta({ generationStatus: 'generating', streamId: 's_old' }),
      ],
      memberMirror: [memberMirrorRow('user_member')],
    };
    const ctx = makeCtx(tables);

    await turnHandler(ctx, baseArgs);

    expect(mockCancelGeneration).toHaveBeenCalledWith(
      ctx,
      'user_owner',
      't_app',
    );
  });
});

/**
 * #2661 — `chatWithAgentTurn` re-enforces the composer's attachment caps
 * server-side (count / per-file size / total size / MIME allowlist),
 * mirroring `validateTaskAttachments` (convex/tasks/attachments.ts). Before
 * this, a scripted client bypassing `useConvexFileUpload`'s client-side
 * gates could attach an unbounded `attachments[]` — none of these four caps
 * were re-checked here.
 */
describe('chatWithAgentTurn — attachment caps (#2661)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user_owner',
      email: 'owner@example.com',
      name: 'Owner',
    });
    mockCreateStream.mockResolvedValue('stream_1');
  });

  function pdfAttachment(fileSize: number, i: number) {
    return {
      fileId: `file_${i}`,
      fileName: `doc-${i}.pdf`,
      fileType: 'application/pdf',
      fileSize,
    };
  }

  function ownerCtx() {
    const tables: Record<string, Row[]> = {
      threadMetadata: [appThreadMeta({ kind: undefined })],
      memberMirror: [],
    };
    return { tables, ctx: makeCtx(tables) };
  }

  it('rejects an over-count attachment set (the bypass: 11 files)', async () => {
    const { tables, ctx } = ownerCtx();
    const attachments = Array.from({ length: 11 }, (_, i) =>
      pdfAttachment(1024, i),
    );

    await expect(
      turnHandler(ctx, { ...baseArgs, attachments }),
    ).rejects.toMatchObject({ data: { code: 'CHAT_ATTACHMENTS_TOO_MANY' } });
    expect(tables.threadMetadata?.[0]?.generationStatus).toBeUndefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('rejects a single oversized file (the bypass: 5e8 bytes)', async () => {
    const { tables, ctx } = ownerCtx();
    const attachments = [pdfAttachment(5e8, 0)];

    await expect(
      turnHandler(ctx, { ...baseArgs, attachments }),
    ).rejects.toMatchObject({ data: { code: 'CHAT_ATTACHMENT_TOO_LARGE' } });
    expect(tables.threadMetadata?.[0]?.generationStatus).toBeUndefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('rejects a total size over the combined cap even with each file individually under the per-file cap', async () => {
    const { tables, ctx } = ownerCtx();
    // 3 files x 90 MB = 270 MB > the 200 MB total cap, each under the 100 MB
    // per-file cap on its own.
    const ninetyMb = 90 * 1024 * 1024;
    const attachments = [
      pdfAttachment(ninetyMb, 0),
      pdfAttachment(ninetyMb, 1),
      pdfAttachment(ninetyMb, 2),
    ];

    await expect(
      turnHandler(ctx, { ...baseArgs, attachments }),
    ).rejects.toMatchObject({
      data: { code: 'CHAT_ATTACHMENTS_TOTAL_SIZE_EXCEEDED' },
    });
    expect(tables.threadMetadata?.[0]?.generationStatus).toBeUndefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME type', async () => {
    const { tables, ctx } = ownerCtx();
    const attachments = [
      {
        fileId: 'file_0',
        fileName: 'payload.exe',
        fileType: 'application/x-msdownload',
        fileSize: 1024,
      },
    ];

    await expect(
      turnHandler(ctx, { ...baseArgs, attachments }),
    ).rejects.toMatchObject({ data: { code: 'CHAT_ATTACHMENT_TYPE_INVALID' } });
    expect(tables.threadMetadata?.[0]?.generationStatus).toBeUndefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('accepts an attachment set within every cap', async () => {
    const { tables, ctx } = ownerCtx();
    const attachments = [pdfAttachment(1024, 0), pdfAttachment(2048, 1)];

    const result = await turnHandler(ctx, { ...baseArgs, attachments });

    expect(result.streamId).toBe('stream_1');
    expect(tables.threadMetadata?.[0]?.generationStatus).toBe('generating');
  });
});
