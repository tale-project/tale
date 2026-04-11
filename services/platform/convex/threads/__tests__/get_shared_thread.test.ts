import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/server', () => ({
  query: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockIsOrgMember = vi.fn();
vi.mock('../../lib/rls/auth/check_org_membership', () => ({
  isOrgMember: (...args: unknown[]) => mockIsOrgMember(...args),
}));

const mockGetThreadMessages = vi.fn();
vi.mock('../get_thread_messages', () => ({
  getThreadMessages: (...args: unknown[]) => mockGetThreadMessages(...args),
}));

const { getSharedThread: getSharedThreadQuery } =
  await import('../get_shared_thread');
const getSharedThread = getSharedThreadQuery as unknown as (
  ctx: unknown,
  args: { shareToken: string },
) => Promise<Record<string, unknown> | null>;

function createMockCtx(metadata?: Record<string, unknown> | null) {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          first: vi
            .fn()
            .mockResolvedValue(
              metadata
                ? { threadId: 'thread_1', userId: 'user_1', ...metadata }
                : null,
            ),
        }),
      }),
    },
  };
}

const VALID_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

describe('getSharedThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_2' });
    mockIsOrgMember.mockResolvedValue(true);
    mockGetThreadMessages.mockResolvedValue({
      messages: [
        { _id: 'msg_1', _creationTime: 1000, role: 'user', content: 'hello' },
        {
          _id: 'msg_2',
          _creationTime: 2000,
          role: 'assistant',
          content: 'hi',
        },
      ],
    });
  });

  it('returns null when unauthenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const result = await getSharedThread(createMockCtx(), {
      shareToken: VALID_TOKEN,
    });
    expect(result).toBeNull();
  });

  it('returns null for invalid token format', async () => {
    const result = await getSharedThread(createMockCtx(), {
      shareToken: 'not-a-uuid',
    });
    expect(result).toBeNull();
  });

  it('returns null when no metadata found', async () => {
    const result = await getSharedThread(createMockCtx(null), {
      shareToken: VALID_TOKEN,
    });
    expect(result).toBeNull();
  });

  it('returns null when thread is not shared', async () => {
    const result = await getSharedThread(createMockCtx({ isShared: false }), {
      shareToken: VALID_TOKEN,
    });
    expect(result).toBeNull();
  });

  it('returns null when user is not in the same org', async () => {
    mockIsOrgMember.mockResolvedValue(false);
    const result = await getSharedThread(
      createMockCtx({ isShared: true, organizationId: 'org_1' }),
      { shareToken: VALID_TOKEN },
    );
    expect(result).toBeNull();
  });

  it('allows access when thread has no organizationId (legacy)', async () => {
    const result = await getSharedThread(
      createMockCtx({ isShared: true, title: 'Test' }),
      { shareToken: VALID_TOKEN },
    );
    expect(result).not.toBeNull();
    expect(mockIsOrgMember).not.toHaveBeenCalled();
  });

  it('returns thread data with messages for valid shared thread', async () => {
    const result = await getSharedThread(
      createMockCtx({
        isShared: true,
        organizationId: 'org_1',
        title: 'My chat',
        createdAt: 500,
        sharedBy: 'user_1',
        agentSlug: 'default',
      }),
      { shareToken: VALID_TOKEN },
    );
    expect(result).toEqual({
      threadId: 'thread_1',
      title: 'My chat',
      createdAt: 500,
      sharedBy: 'user_1',
      agentSlug: 'default',
      messages: expect.arrayContaining([
        expect.objectContaining({ _id: 'msg_1' }),
        expect.objectContaining({ _id: 'msg_2' }),
      ]),
    });
  });

  it('enforces snapshot isolation: excludes messages after sharedAt', async () => {
    mockGetThreadMessages.mockResolvedValue({
      messages: [
        { _id: 'msg_1', _creationTime: 1000, role: 'user', content: 'hello' },
        {
          _id: 'msg_2',
          _creationTime: 2000,
          role: 'assistant',
          content: 'hi',
        },
        {
          _id: 'msg_3',
          _creationTime: 5000,
          role: 'user',
          content: 'after share',
        },
      ],
    });

    const result = await getSharedThread(
      createMockCtx({
        isShared: true,
        organizationId: 'org_1',
        sharedAt: 3000,
        title: 'Test',
        createdAt: 500,
        sharedBy: 'user_1',
      }),
      { shareToken: VALID_TOKEN },
    );

    const messages = result?.messages;
    expect(messages).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- asserted above
    const messageIds = (messages! as Array<{ _id: string }>).map((m) => m._id);
    expect(messageIds).toContain('msg_1');
    expect(messageIds).toContain('msg_2');
    expect(messageIds).not.toContain('msg_3');
  });
});
