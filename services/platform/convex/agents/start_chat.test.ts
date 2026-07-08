import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `startChat`'s thread gate — the internal defense-in-depth mirror of
 * `chatWithAgentTurn`'s public-entry check: owner-only for every kind EXCEPT
 * `automation_discussion`, where a non-owner member of the thread's own org may
 * drive turns (membership itself is enforced by the `resolvedRole` lookup /
 * pre-resolved governance, mocked here).
 */

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

const mockGetOrganizationMember = vi.fn();
vi.mock('../lib/rls', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

const mockStartAgentChat = vi.fn();
vi.mock('../lib/agent_chat', () => ({
  startAgentChat: (...args: unknown[]) => mockStartAgentChat(...args),
}));

const { startChat } = await import('./start_chat');

interface StartChatArgs {
  threadId: string;
  organizationId: string;
  userId: string;
  userEmail: string;
  userName: string;
  message: string;
  agentConfig: Record<string, unknown>;
  agentSlug: string;
}

const startChatHandler = (
  startChat as unknown as {
    handler: (
      ctx: unknown,
      args: StartChatArgs,
    ) => Promise<{ messageAlreadyExists: boolean; streamId: string }>;
  }
).handler;

type Row = Record<string, unknown> & { _id: string };

function makeCtx(threadMeta: Row | null) {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          first: () => Promise.resolve(threadMeta),
        }),
      }),
      patch: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const baseArgs: StartChatArgs = {
  threadId: 't_app',
  organizationId: 'org_1',
  userId: 'user_member',
  userEmail: 'member@example.com',
  userName: 'Member',
  message: 'hello',
  agentConfig: {},
  agentSlug: 'assistant',
};

describe('startChat — thread gate (defense-in-depth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    mockStartAgentChat.mockResolvedValue({
      messageAlreadyExists: false,
      streamId: 's_1',
    });
  });

  it('lets a non-owner member through on an automation_discussion thread in the same org', async () => {
    const ctx = makeCtx({
      _id: 'tm_1',
      threadId: 't_app',
      userId: 'user_owner',
      organizationId: 'org_1',
      kind: 'automation_discussion',
    });

    const result = await startChatHandler(ctx, baseArgs);

    expect(result.streamId).toBe('s_1');
    expect(mockStartAgentChat).toHaveBeenCalledTimes(1);
  });

  it('still denies a non-owner on a plain chat thread', async () => {
    const ctx = makeCtx({
      _id: 'tm_1',
      threadId: 't_app',
      userId: 'user_owner',
      organizationId: 'org_1',
    });

    await expect(startChatHandler(ctx, baseArgs)).rejects.toThrow(
      'Thread not found',
    );
    expect(mockStartAgentChat).not.toHaveBeenCalled();
  });

  it('denies a non-owner when the automation_discussion belongs to a different org', async () => {
    const ctx = makeCtx({
      _id: 'tm_1',
      threadId: 't_app',
      userId: 'user_owner',
      organizationId: 'org_other',
      kind: 'automation_discussion',
    });

    await expect(startChatHandler(ctx, baseArgs)).rejects.toThrow(
      'Thread not found',
    );
    expect(mockStartAgentChat).not.toHaveBeenCalled();
  });

  it('keeps the owner path working', async () => {
    const ctx = makeCtx({
      _id: 'tm_1',
      threadId: 't_app',
      userId: 'user_member',
      organizationId: 'org_1',
    });

    const result = await startChatHandler(ctx, baseArgs);

    expect(result.streamId).toBe('s_1');
  });
});
