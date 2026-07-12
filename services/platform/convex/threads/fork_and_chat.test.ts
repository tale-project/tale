import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `forkAndChat` — the shared-view "attach + send" path. Two things this spec
 * pins down:
 *  - #2661 sweep: attachments staged before the first send on a shared view
 *    are re-validated against the same caps `chatWithAgentTurn` enforces
 *    (mocked here — its own behaviour is covered by chat_turn.test.ts).
 *  - #2663: the caps aside, `attachments` must actually reach `startChat` —
 *    previously `forkAndChat` had no `attachments` arg at all, so a shared-view
 *    attachment-only send silently dropped every file.
 */

vi.mock('../_generated/server', () => ({
  action: (config: unknown) => config,
}));

vi.mock('../_generated/api', () => ({
  api: {
    threads: {
      mutations: { forkThread: 'api:threads:mutations:forkThread' },
    },
  },
  internal: {
    threads: {
      internal_queries: {
        getThreadMetadata:
          'internal:threads:internal_queries:getThreadMetadata',
      },
    },
    agents: {
      file_actions: {
        resolveAgentConfig: 'internal:agents:file_actions:resolveAgentConfig',
      },
      start_chat: { startChat: 'internal:agents:start_chat:startChat' },
    },
  },
}));

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

const mockValidateChatAttachmentCaps = vi.fn();
vi.mock('../agents/chat_turn', () => ({
  validateChatAttachmentCaps: (...args: unknown[]) =>
    mockValidateChatAttachmentCaps(...args),
}));

const { forkAndChat } = await import('./fork_and_chat');

interface ForkAndChatArgs {
  shareToken: string;
  message: string;
  agentSlug: string;
  organizationId: string;
  attachments?: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }>;
}

const handler = (
  forkAndChat as unknown as {
    handler: (
      ctx: {
        runMutation: (ref: string, args: unknown) => Promise<unknown>;
        runQuery: (ref: string, args: unknown) => Promise<unknown>;
        runAction: (ref: string, args: unknown) => Promise<unknown>;
      },
      args: ForkAndChatArgs,
    ) => Promise<{ threadId: string; streamId: string }>;
  }
).handler;

function makeCtx() {
  return {
    runMutation: vi.fn(),
    runQuery: vi.fn(),
    runAction: vi.fn(),
  };
}

const baseArgs: ForkAndChatArgs = {
  shareToken: 'tok_1',
  message: 'hello',
  agentSlug: 'assistant',
  organizationId: 'org_1',
};

describe('forkAndChat — attachments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org_1',
      orgSlug: 'org-1',
      userId: 'user_1',
      email: 'user@example.com',
      name: 'User',
      member: { _id: 'm1', role: 'member' },
    });
    // Default: caps pass. Individual tests override to exercise the reject path.
    mockValidateChatAttachmentCaps.mockImplementation(() => undefined);
  });

  it('rejects a capped-out attachment set before forking anything (#2661 sweep)', async () => {
    mockValidateChatAttachmentCaps.mockImplementation(() => {
      throw new Error('CHAT_ATTACHMENTS_TOO_MANY');
    });
    const ctx = makeCtx();
    const attachments = [
      {
        fileId: 'f1',
        fileName: 'x.pdf',
        fileType: 'application/pdf',
        fileSize: 10,
      },
    ];

    await expect(handler(ctx, { ...baseArgs, attachments })).rejects.toThrow(
      'CHAT_ATTACHMENTS_TOO_MANY',
    );

    expect(mockValidateChatAttachmentCaps).toHaveBeenCalledWith(attachments);
    // Nothing committed: the fork mutation never ran.
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('threads attachments through to startChat on a successful fork (#2663)', async () => {
    const ctx = makeCtx();
    ctx.runMutation.mockImplementation((ref: string) => {
      if (ref === 'api:threads:mutations:forkThread') {
        return Promise.resolve('thread_new');
      }
      if (ref === 'internal:agents:start_chat:startChat') {
        return Promise.resolve({ streamId: 'stream_1' });
      }
      throw new Error(`unexpected runMutation ref: ${ref}`);
    });
    ctx.runQuery.mockResolvedValue({ organizationId: 'org_1' });
    ctx.runAction.mockResolvedValue({ model: 'default' });

    const attachments = [
      {
        fileId: 'f1',
        fileName: 'x.pdf',
        fileType: 'application/pdf',
        fileSize: 10,
      },
    ];
    const result = await handler(ctx, { ...baseArgs, attachments });

    expect(result).toEqual({ threadId: 'thread_new', streamId: 'stream_1' });
    expect(mockValidateChatAttachmentCaps).toHaveBeenCalledWith(attachments);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'internal:agents:start_chat:startChat',
      expect.objectContaining({ attachments }),
    );
  });

  it('sends a plain (attachment-less) message without regressing the no-attachment path', async () => {
    const ctx = makeCtx();
    ctx.runMutation.mockImplementation((ref: string) => {
      if (ref === 'api:threads:mutations:forkThread') {
        return Promise.resolve('thread_new');
      }
      if (ref === 'internal:agents:start_chat:startChat') {
        return Promise.resolve({ streamId: 'stream_1' });
      }
      throw new Error(`unexpected runMutation ref: ${ref}`);
    });
    ctx.runQuery.mockResolvedValue({ organizationId: 'org_1' });
    ctx.runAction.mockResolvedValue({ model: 'default' });

    const result = await handler(ctx, baseArgs);

    expect(result).toEqual({ threadId: 'thread_new', streamId: 'stream_1' });
    expect(mockValidateChatAttachmentCaps).toHaveBeenCalledWith(undefined);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'internal:agents:start_chat:startChat',
      expect.objectContaining({ attachments: undefined }),
    );
  });
});
