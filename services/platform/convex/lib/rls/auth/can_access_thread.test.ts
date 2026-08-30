import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
      },
    },
    agent: {
      threads: {
        getThread: 'agent:threads:getThread',
      },
    },
  },
}));

const { canAccessThread, assertThreadAccess, canAccessThreadOrSubThread } =
  await import('./can_access_thread');

const authUser = { userId: 'user_1', email: 'larry@tale.dev' };

interface MockMetadata {
  _id: string;
  threadId: string;
  userId: string;
  organizationId?: string;
  isShared?: boolean;
  status?: string;
  kind?: 'chat' | 'task_discussion' | 'automation_discussion';
}

interface BetterAuthMember {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
}

function createMockCtx(opts: {
  metadata: MockMetadata | null;
  members?: BetterAuthMember[]; // Better Auth `member` rows the user belongs to (active)
}) {
  return {
    db: {
      // `threadMetadata` returns the seeded row; the `memberMirror` cache reads
      // empty so `isOrgMember` falls through to the Better Auth `runQuery` path
      // these tests drive.
      query: vi.fn().mockImplementation((table: string) => ({
        withIndex: vi.fn().mockReturnValue({
          first: vi
            .fn()
            .mockResolvedValue(table === 'memberMirror' ? null : opts.metadata),
        }),
      })),
    },
    runQuery: vi
      .fn()
      .mockImplementation(
        (_ref, args: { where: { field: string; value: string }[] }) => {
          // isOrgMember queries the `member` table by userId (and an optional
          // org filter on the legacy fallback path) and resolves the org match
          // in memory. Return every row matching the where clauses present, as
          // a single terminated page.
          const orgIdFilter = args.where.find(
            (w) => w.field === 'organizationId',
          );
          const userIdFilter = args.where.find((w) => w.field === 'userId');
          const page = (opts.members ?? []).filter(
            (m) =>
              (orgIdFilter === undefined ||
                m.organizationId === orgIdFilter.value) &&
              (userIdFilter === undefined || m.userId === userIdFilter.value),
          );
          return Promise.resolve({ page, isDone: true, continueCursor: '' });
        },
      ),
    auth: {},
  };
}

describe('canAccessThread — owner branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata when owner is still a member of the thread org (no hint)', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_1',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        },
      ],
    });

    const result = await canAccessThread(ctx as never, 't_1', authUser);

    expect(result).toEqual(meta);
    // No hint passed → membership lookup happens sequentially after metadata
    // read. Exactly one runQuery (Better Auth findMany).
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('returns metadata via fast path when matching hint is supplied', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_1',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_1',
      authUser,
      'org_1',
    );

    expect(result).toEqual(meta);
    // Fast path reuses the parallel-fired membership lookup → single call.
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('denies access when the active-org hint does not match the thread org', async () => {
    // The coherence boundary. The user OWNS the thread and is a member of BOTH
    // orgs, but is acting in `org_hint` while the thread lives in `org_actual`.
    // Pre-fix this fell back to a second lookup and GRANTED on `org_actual`
    // membership — exactly how org-A's thread rendered while switched to org B.
    // With the active-org hint enforced, a mismatch is denied outright.
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_actual',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_hint',
          organizationId: 'org_hint',
          userId: 'user_1',
          role: 'member',
        },
        {
          _id: 'm_actual',
          organizationId: 'org_actual',
          userId: 'user_1',
          role: 'admin',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_1',
      authUser,
      'org_hint',
    );

    expect(result).toBeNull();
    // The mismatch is decided from the single parallel-fired hint lookup — no
    // second lookup against the thread's actual org.
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('returns null when owner is no longer a member of the thread org (no hint)', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_deleted',
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(ctx as never, 't_1', authUser);

    expect(result).toBeNull();
  });

  it('returns null on the fast path when the matching hint reveals non-membership', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_deleted',
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(
      ctx as never,
      't_1',
      authUser,
      'org_deleted',
    );

    expect(result).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('returns metadata for legacy threads without organizationId regardless of hint', async () => {
    const meta: MockMetadata = {
      _id: 'tm_legacy',
      threadId: 't_legacy',
      userId: 'user_1',
      // organizationId intentionally omitted — pre-org-scoping legacy row
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(
      ctx as never,
      't_legacy',
      authUser,
      'org_anything',
    );

    expect(result).toEqual(meta);
  });
});

describe('canAccessThread — shared branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata for non-owner who is a member of the shared org (fast path)', async () => {
    const meta: MockMetadata = {
      _id: 'tm_shared',
      threadId: 't_shared',
      userId: 'user_owner',
      organizationId: 'org_shared',
      isShared: true,
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_shared',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_shared',
      authUser,
      'org_shared',
    );

    expect(result).toEqual(meta);
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('denies a non-owner member when the active-org hint differs from the shared org', async () => {
    // Non-owner is a member of both `org_shared` and `org_other` but is acting
    // in `org_other`. The shared thread belongs to `org_shared`, so supplying
    // the active org as the hint must deny: it is not in the org the user is
    // currently in, even though sharing + membership would otherwise grant.
    const meta: MockMetadata = {
      _id: 'tm_shared',
      threadId: 't_shared',
      userId: 'user_owner',
      organizationId: 'org_shared',
      isShared: true,
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_shared',
          organizationId: 'org_shared',
          userId: 'user_1',
          role: 'member',
        },
        {
          _id: 'm_other',
          organizationId: 'org_other',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_shared',
      authUser,
      'org_other',
    );

    expect(result).toBeNull();
  });

  it('returns null for non-owner who is not a member of the shared org', async () => {
    const meta: MockMetadata = {
      _id: 'tm_shared',
      threadId: 't_shared',
      userId: 'user_owner',
      organizationId: 'org_shared',
      isShared: true,
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(ctx as never, 't_shared', authUser);

    expect(result).toBeNull();
  });

  it('returns null for non-owner when thread is not shared', async () => {
    const meta: MockMetadata = {
      _id: 'tm_private',
      threadId: 't_private',
      userId: 'user_owner',
      organizationId: 'org_1',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(ctx as never, 't_private', authUser);

    expect(result).toBeNull();
  });
});

describe('canAccessThread — discussion branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grants a non-owner org member access to a task_discussion', async () => {
    // Comment threads are a shared surface: unlike a private `chat` thread,
    // any member of the thread's org may read/reply even though it isn't
    // `isShared`.
    const meta: MockMetadata = {
      _id: 'tm_disc',
      threadId: 't_disc',
      userId: 'user_owner',
      organizationId: 'org_disc',
      kind: 'task_discussion',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_disc',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_disc',
      authUser,
      'org_disc',
    );

    expect(result).toEqual(meta);
  });

  it('grants a non-owner org member access to a task_discussion', async () => {
    const meta: MockMetadata = {
      _id: 'tm_task_disc',
      threadId: 't_task_disc',
      userId: 'user_owner',
      organizationId: 'org_disc',
      kind: 'task_discussion',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_disc',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(ctx as never, 't_task_disc', authUser);

    expect(result).toEqual(meta);
  });

  it('grants a non-owner org member access to an automation_discussion without a projectId', async () => {
    // App-embedded discussions (AgentChat block) are org-membership-gated like
    // the other discussion kinds — and, unlike project/task discussions, may
    // carry no projectId at all. Membership in the thread's org is the gate.
    const meta: MockMetadata = {
      _id: 'tm_app_disc',
      threadId: 't_app_disc',
      userId: 'user_owner',
      organizationId: 'org_disc',
      kind: 'automation_discussion',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_disc',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_app_disc',
      authUser,
      'org_disc',
    );

    expect(result).toEqual(meta);
  });

  it('denies an automation_discussion when the active-org hint differs from the thread org', async () => {
    // Cross-org coherence: the caller is a member of BOTH orgs but is acting
    // in org_other; the app thread lives in org_disc, so the hint must deny.
    const meta: MockMetadata = {
      _id: 'tm_app_disc',
      threadId: 't_app_disc',
      userId: 'user_owner',
      organizationId: 'org_disc',
      kind: 'automation_discussion',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_disc',
          organizationId: 'org_disc',
          userId: 'user_1',
          role: 'member',
        },
        {
          _id: 'm_other',
          organizationId: 'org_other',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_app_disc',
      authUser,
      'org_other',
    );

    expect(result).toBeNull();
  });

  it('denies an automation_discussion to a non-member of the thread org', async () => {
    const meta: MockMetadata = {
      _id: 'tm_app_disc',
      threadId: 't_app_disc',
      userId: 'user_owner',
      organizationId: 'org_disc',
      kind: 'automation_discussion',
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(ctx as never, 't_app_disc', authUser);

    expect(result).toBeNull();
  });

  it('denies a non-owner who is not a member of the discussion org', async () => {
    const meta: MockMetadata = {
      _id: 'tm_disc',
      threadId: 't_disc',
      userId: 'user_owner',
      organizationId: 'org_disc',
      kind: 'task_discussion',
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(ctx as never, 't_disc', authUser);

    expect(result).toBeNull();
  });

  it('does not grant non-members access to a non-discussion thread on kind alone', async () => {
    // A private `chat` thread (kind absent) must NOT inherit the discussion
    // branch's org-wide access — only owner / shared branches apply.
    const meta: MockMetadata = {
      _id: 'tm_chat',
      threadId: 't_chat',
      userId: 'user_owner',
      organizationId: 'org_disc',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_disc',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(ctx as never, 't_chat', authUser);

    expect(result).toBeNull();
  });
});

describe('canAccessThread — missing thread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when threadMetadata row does not exist', async () => {
    const ctx = createMockCtx({ metadata: null });

    const result = await canAccessThread(ctx as never, 't_missing', authUser);

    expect(result).toBeNull();
  });
});

describe('assertThreadAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata when accessible', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_1',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        },
      ],
    });

    const result = await assertThreadAccess(
      ctx as never,
      't_1',
      authUser,
      'org_1',
    );

    expect(result).toEqual(meta);
  });

  it('throws AppError(forbidden) when access is denied', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_deleted',
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    await expect(
      assertThreadAccess(ctx as never, 't_1', authUser),
    ).rejects.toMatchObject({ data: { code: 'forbidden' } });
  });
});

/**
 * Mock ctx for the sub-thread tests: `threadMetadata` is keyed by threadId (so
 * a sub-thread can resolve to `null` while its parent resolves to a real row),
 * and `agent.threads.getThread` is served from `summariesByThreadId`.
 */
function createSubThreadMockCtx(opts: {
  metadataByThreadId: Record<string, MockMetadata>;
  summariesByThreadId?: Record<string, string | undefined>;
  members?: BetterAuthMember[];
}) {
  return {
    db: {
      query: vi.fn().mockImplementation((table: string) => ({
        withIndex: vi
          .fn()
          .mockImplementation(
            (_index: string, builder?: (q: unknown) => unknown) => {
              let capturedThreadId: string | undefined;
              if (builder) {
                const q = {
                  eq: (field: string, value: string) => {
                    if (field === 'threadId') capturedThreadId = value;
                    return q;
                  },
                };
                builder(q);
              }
              return {
                first: vi
                  .fn()
                  .mockResolvedValue(
                    table === 'memberMirror'
                      ? null
                      : capturedThreadId
                        ? (opts.metadataByThreadId[capturedThreadId] ?? null)
                        : null,
                  ),
              };
            },
          ),
      })),
    },
    runQuery: vi
      .fn()
      .mockImplementation(
        (
          ref: string,
          args:
            | { threadId: string }
            | { where: { field: string; value: string }[] },
        ) => {
          if (ref === 'agent:threads:getThread') {
            const threadId = (args as { threadId: string }).threadId;
            const summary = opts.summariesByThreadId?.[threadId];
            return Promise.resolve(summary !== undefined ? { summary } : null);
          }
          // isOrgMember → Better Auth `member` findMany
          const where = (args as { where: { field: string; value: string }[] })
            .where;
          const orgIdFilter = where.find((w) => w.field === 'organizationId');
          const userIdFilter = where.find((w) => w.field === 'userId');
          const page = (opts.members ?? []).filter(
            (m) =>
              (orgIdFilter === undefined ||
                m.organizationId === orgIdFilter.value) &&
              (userIdFilter === undefined || m.userId === userIdFilter.value),
          );
          return Promise.resolve({ page, isDone: true, continueCursor: '' });
        },
      ),
    auth: {},
  };
}

describe('canAccessThreadOrSubThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const parentMeta: MockMetadata = {
    _id: 'tm_parent',
    threadId: 't_parent',
    userId: 'user_1',
    organizationId: 'org_1',
  };
  const ownerMembers: BetterAuthMember[] = [
    { _id: 'm_1', organizationId: 'org_1', userId: 'user_1', role: 'admin' },
  ];

  it('grants access to a sub-thread whose parent the user can access', async () => {
    // The sub-thread has NO threadMetadata row of its own (the Agent SDK
    // component creates it without one) — access is inherited from the parent.
    const ctx = createSubThreadMockCtx({
      metadataByThreadId: { t_parent: parentMeta },
      summariesByThreadId: {
        t_sub: JSON.stringify({
          subAgentType: 'researcher',
          parentThreadId: 't_parent',
        }),
      },
      members: ownerMembers,
    });

    const result = await canAccessThreadOrSubThread(
      ctx as never,
      't_sub',
      authUser,
    );

    expect(result).toEqual(parentMeta);
  });

  it('denies a sub-thread whose parent the user cannot access', async () => {
    const ctx = createSubThreadMockCtx({
      // Parent exists but the user is not a member of its org.
      metadataByThreadId: {
        t_parent: { ...parentMeta, userId: 'user_other' },
      },
      summariesByThreadId: {
        t_sub: JSON.stringify({ parentThreadId: 't_parent' }),
      },
      members: [],
    });

    const result = await canAccessThreadOrSubThread(
      ctx as never,
      't_sub',
      authUser,
    );

    expect(result).toBeNull();
  });

  it('denies a thread that has neither metadata nor a parent summary', async () => {
    const ctx = createSubThreadMockCtx({
      metadataByThreadId: {},
      summariesByThreadId: { t_orphan: undefined },
      members: ownerMembers,
    });

    const result = await canAccessThreadOrSubThread(
      ctx as never,
      't_orphan',
      authUser,
    );

    expect(result).toBeNull();
  });

  it('walks nested delegation up to an accessible ancestor', async () => {
    // sub2 → sub1 → parent(owned). Both intermediate sub-threads lack metadata.
    const ctx = createSubThreadMockCtx({
      metadataByThreadId: { t_parent: parentMeta },
      summariesByThreadId: {
        t_sub2: JSON.stringify({ parentThreadId: 't_sub1' }),
        t_sub1: JSON.stringify({ parentThreadId: 't_parent' }),
      },
      members: ownerMembers,
    });

    const result = await canAccessThreadOrSubThread(
      ctx as never,
      't_sub2',
      authUser,
    );

    expect(result).toEqual(parentMeta);
  });
});
