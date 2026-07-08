import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `getAutomationThread` / `getOrCreateAutomationThread` — the AgentChat block's shared
 * per-(org, app, subject) thread. Membership runs through the REAL
 * `isOrgMember` / `getOrganizationMember` helpers against a seeded
 * `memberMirror` row (mirror hit ⇒ no Better Auth round-trip); a missing
 * mirror row falls through to the mocked-empty Better Auth pages ⇒ denial.
 */

const mockCreateThread = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  createThread: (...args: unknown[]) => mockCreateThread(...args),
}));

vi.mock('../_generated/api', () => ({
  components: {
    agent: { threads: { getThread: 'agent:threads:getThread' } },
    betterAuth: { adapter: { findMany: 'betterAuth:adapter:findMany' } },
  },
}));

// Identity factory so registered functions expose their raw config — lets
// tests call handlers directly (same pattern as message_queue.test.ts).
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
    mutation: (config: Record<string, unknown>) => config,
  };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const { getAutomationThread, getOrCreateAutomationThread } =
  await import('./get_or_create_automation_thread');

interface FunctionDef<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn>;
}

interface SubjectArgs {
  organizationId: string;
  automationSlug: string;
  subjectType: string;
  subjectId: string;
}

const getAutomationThreadHandler = (
  getAutomationThread as unknown as FunctionDef<
    SubjectArgs,
    { threadId: string } | null
  >
).handler;
const getOrCreateHandler = (
  getOrCreateAutomationThread as unknown as FunctionDef<
    SubjectArgs & { projectId?: string; title?: string },
    { threadId: string }
  >
).handler;

type Row = Record<string, unknown> & { _id: string };

/** Tiny in-memory convex db: filters rows by the eq() calls the index
 * callback makes, supports first() + async iteration, and appends on
 * insert so a later lookup inside the same test sees the created row. */
function makeCtx(tables: Record<string, Row[]>) {
  let nextId = 1;
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
            [Symbol.asyncIterator]: function* () {
              yield* rows;
            } as unknown as () => AsyncIterator<Row>,
          };
        },
      }),
      insert: vi.fn((table: string, doc: Record<string, unknown>) => {
        const row: Row = { _id: `${table}_${nextId++}`, ...doc };
        (tables[table] ??= []).push(row);
        return Promise.resolve(row._id);
      }),
    },
    // Better Auth fallback (mirror miss): every page is empty ⇒ non-member.
    runQuery: vi
      .fn()
      .mockResolvedValue({ page: [], isDone: true, continueCursor: '' }),
    auth: {},
  };
  return ctx;
}

function memberMirrorRow(
  userId: string,
  organizationId = 'org_1',
  role = 'member',
): Row {
  return {
    _id: `mm_${userId}`,
    memberId: `member_${userId}`,
    organizationId,
    userId,
    role,
    createdAt: 1,
  };
}

const subject: SubjectArgs = {
  organizationId: 'org_1',
  automationSlug: 'issue-desk',
  subjectType: 'task',
  subjectId: 'task_42',
};

const assistantSubject: SubjectArgs = {
  organizationId: 'org_1',
  automationSlug: 'issue-desk',
  subjectType: 'assistant',
  subjectId: 'issue-desk',
};

describe('getOrCreateAutomationThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user_1',
      email: 'u1@example.com',
      name: 'User One',
    });
    let n = 0;
    mockCreateThread.mockImplementation(() => Promise.resolve(`thread_${++n}`));
  });

  it('is idempotent: the same triplet resolves to the same threadId', async () => {
    const tables = { memberMirror: [memberMirrorRow('user_1')] };
    const ctx = makeCtx(tables);

    const first = await getOrCreateHandler(ctx, subject);
    const second = await getOrCreateHandler(ctx, subject);

    expect(first.threadId).toBe('thread_1');
    expect(second.threadId).toBe('thread_1');
    expect(mockCreateThread).toHaveBeenCalledTimes(1);
  });

  it('a different subject gets its own thread', async () => {
    const tables = { memberMirror: [memberMirrorRow('user_1')] };
    const ctx = makeCtx(tables);

    const a = await getOrCreateHandler(ctx, subject);
    const b = await getOrCreateHandler(ctx, {
      ...subject,
      subjectId: 'task_43',
    });

    expect(a.threadId).not.toBe(b.threadId);
    expect(mockCreateThread).toHaveBeenCalledTimes(2);
  });

  it('writes the full automation_discussion metadata shape on create', async () => {
    const tables: Record<string, Row[]> = {
      memberMirror: [memberMirrorRow('user_1')],
    };
    const ctx = makeCtx(tables);

    await getOrCreateHandler(ctx, { ...subject, title: 'Task chat' });

    const row = tables.threadMetadata?.[0];
    expect(row).toMatchObject({
      threadId: 'thread_1',
      userId: 'user_1',
      chatType: 'general',
      status: 'active',
      kind: 'automation_discussion',
      automationSlug: 'issue-desk',
      subjectType: 'task',
      subjectId: 'task_42',
      organizationId: 'org_1',
      title: 'Task chat',
      generationStatus: 'idle',
      discussionStatus: 'open',
      agentReplyDepth: 0,
      // Shared surface ⇒ personalization force-disabled at create.
      disablePersonalization: true,
    });
    expect(row?.projectId).toBeUndefined();
  });

  it('denies a non-member of the organization', async () => {
    // No memberMirror row + empty Better Auth pages ⇒ getOrganizationMember
    // throws before any lookup/insert happens.
    const tables: Record<string, Row[]> = { memberMirror: [] };
    const ctx = makeCtx(tables);

    await expect(getOrCreateHandler(ctx, subject)).rejects.toThrow(
      /Not a member of organization/,
    );
    expect(mockCreateThread).not.toHaveBeenCalled();
    expect(tables.threadMetadata ?? []).toHaveLength(0);
  });

  it('rejects an empty-string subject component', async () => {
    const ctx = makeCtx({ memberMirror: [memberMirrorRow('user_1')] });

    await expect(
      getOrCreateHandler(ctx, { ...subject, subjectId: '  ' }),
    ).rejects.toMatchObject({ data: { code: 'bad_request' } });
    expect(mockCreateThread).not.toHaveBeenCalled();
  });

  it('skips trashed residue and mints a fresh active thread', async () => {
    const tables: Record<string, Row[]> = {
      memberMirror: [memberMirrorRow('user_1')],
      threadMetadata: [
        {
          _id: 'tm_old',
          threadId: 'thread_old',
          status: 'trashed',
          kind: 'automation_discussion',
          ...subject,
        },
      ],
    };
    const ctx = makeCtx(tables);

    const result = await getOrCreateHandler(ctx, subject);

    expect(result.threadId).toBe('thread_1');
    expect(mockCreateThread).toHaveBeenCalledTimes(1);
  });
});

describe('getAutomationThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user_1',
      email: 'u1@example.com',
      name: 'User One',
    });
    let n = 0;
    mockCreateThread.mockImplementation(() => Promise.resolve(`thread_${++n}`));
  });

  it('returns null before create, then resolves the created thread', async () => {
    const tables = { memberMirror: [memberMirrorRow('user_1')] };
    const ctx = makeCtx(tables);

    expect(await getAutomationThreadHandler(ctx, subject)).toBeNull();

    const created = await getOrCreateHandler(ctx, subject);

    expect(await getAutomationThreadHandler(ctx, subject)).toEqual({
      threadId: created.threadId,
    });
  });

  it('returns null (soft denial) for a non-member', async () => {
    const tables: Record<string, Row[]> = {
      memberMirror: [],
      threadMetadata: [
        {
          _id: 'tm_1',
          threadId: 'thread_1',
          status: 'active',
          kind: 'automation_discussion',
          ...subject,
        },
      ],
    };
    const ctx = makeCtx(tables);

    expect(await getAutomationThreadHandler(ctx, subject)).toBeNull();
  });

  it('returns null when unauthenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const ctx = makeCtx({ memberMirror: [memberMirrorRow('user_1')] });

    expect(await getAutomationThreadHandler(ctx, subject)).toBeNull();
  });
});

/**
 * `subjectType: 'assistant'` is the Automation Assistant's app-embedded
 * chat, backed by the `workflow-assistant` agent
 * (`roleRestriction: admin_developer`, mutating create_workflow /
 * save_workflow_definition / update_workflow_step / run_workflow /
 * agent_write tools). The panel hides itself in the UI for member/editor
 * roles, but that gate is UI-only unless the server refuses it too — these
 * cases prove a plain org member/editor cannot mint or read the thread
 * directly, while an org-member developer (and admin/owner) can.
 */
describe('assistant subject: developer-only gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user_1',
      email: 'u1@example.com',
      name: 'User One',
    });
    let n = 0;
    mockCreateThread.mockImplementation(() => Promise.resolve(`thread_${++n}`));
  });

  it('getOrCreateAutomationThread refuses a member', async () => {
    const tables = {
      memberMirror: [memberMirrorRow('user_1', 'org_1', 'member')],
    };
    const ctx = makeCtx(tables);

    await expect(
      getOrCreateHandler(ctx, assistantSubject),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(mockCreateThread).not.toHaveBeenCalled();
  });

  it('getOrCreateAutomationThread refuses an editor', async () => {
    const tables = {
      memberMirror: [memberMirrorRow('user_1', 'org_1', 'editor')],
    };
    const ctx = makeCtx(tables);

    await expect(
      getOrCreateHandler(ctx, assistantSubject),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(mockCreateThread).not.toHaveBeenCalled();
  });

  it('getOrCreateAutomationThread allows an org-member developer', async () => {
    const tables = {
      memberMirror: [memberMirrorRow('user_1', 'org_1', 'developer')],
    };
    const ctx = makeCtx(tables);

    const result = await getOrCreateHandler(ctx, assistantSubject);

    expect(result.threadId).toBe('thread_1');
    expect(mockCreateThread).toHaveBeenCalledTimes(1);
  });

  it('getOrCreateAutomationThread allows an admin', async () => {
    const tables = {
      memberMirror: [memberMirrorRow('user_1', 'org_1', 'admin')],
    };
    const ctx = makeCtx(tables);

    const result = await getOrCreateHandler(ctx, assistantSubject);

    expect(result.threadId).toBe('thread_1');
  });

  it('a non-assistant subjectType is unaffected by the developer gate', async () => {
    const tables = {
      memberMirror: [memberMirrorRow('user_1', 'org_1', 'member')],
    };
    const ctx = makeCtx(tables);

    const result = await getOrCreateHandler(ctx, subject);

    expect(result.threadId).toBe('thread_1');
  });

  it('getAutomationThread returns null (soft denial) for a member', async () => {
    const tables: Record<string, Row[]> = {
      memberMirror: [memberMirrorRow('user_1', 'org_1', 'member')],
      threadMetadata: [
        {
          _id: 'tm_1',
          threadId: 'thread_1',
          status: 'active',
          kind: 'automation_discussion',
          ...assistantSubject,
        },
      ],
    };
    const ctx = makeCtx(tables);

    expect(await getAutomationThreadHandler(ctx, assistantSubject)).toBeNull();
  });

  it('getAutomationThread resolves the thread for an org-member developer', async () => {
    const tables: Record<string, Row[]> = {
      memberMirror: [memberMirrorRow('user_1', 'org_1', 'developer')],
      threadMetadata: [
        {
          _id: 'tm_1',
          threadId: 'thread_1',
          status: 'active',
          kind: 'automation_discussion',
          ...assistantSubject,
        },
      ],
    };
    const ctx = makeCtx(tables);

    expect(await getAutomationThreadHandler(ctx, assistantSubject)).toEqual({
      threadId: 'thread_1',
    });
  });
});
