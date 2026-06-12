import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';

vi.mock('@convex-dev/agent', () => ({
  saveMessage: vi.fn(),
}));

vi.mock('../../_generated/api', () => ({
  components: {
    agent: {
      messages: { updateMessage: 'mock-updateMessage' },
    },
  },
  internal: {
    sandbox: {
      session_mutations: { claimSessionOpFinalize: 'mock-claimFinalize' },
    },
    governance: {
      internal_mutations: { incrementUsageLedger: 'mock-incrementUsage' },
    },
    threads: {
      internal_mutations: { clearGenerationStatus: 'mock-clearGeneration' },
    },
    agents: {
      external_agent: {
        continue_external_agent_turn: {
          continueExternalAgentTurn: 'mock-continueTurn',
        },
      },
    },
  },
}));

vi.mock('../../node_only/sandbox/bifrost_admin', () => ({
  getVirtualKeySpendCents: vi.fn().mockResolvedValue(0),
  revokeVirtualKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../node_only/sandbox/helpers/session_client', () => ({
  sessionCancelExec: vi.fn().mockResolvedValue(undefined),
}));

import type { RunAgentInSessionResult } from '../../node_only/sandbox/run_agent';
import { handleTurnOutcome, type TurnContext } from './turn_lifecycle';

function createMockCtx() {
  return {
    // claimSessionOpFinalize resolves true (this caller wins the claim);
    // updateMessage's resolved value is unused.
    runMutation: vi.fn().mockResolvedValue(true),
    runQuery: vi.fn(),
    scheduler: { runAfter: vi.fn() },
    storage: { store: vi.fn() },
  };
}

function makeTurn(): TurnContext {
  return {
    organizationId: 'org_1',
    sessionId: 'sess_1',
    execId: 'exec_1',
    threadId: 'thread_1',
    agentKind: 'claude-code',
    modelRef: 'anthropic:claude-sonnet-4-6',
    assistantMessageId: 'msg_1',
    mintedKeyId: null,
    continuationCount: 0,
  };
}

function updateMessageCalls(ctx: ReturnType<typeof createMockCtx>) {
  return ctx.runMutation.mock.calls.filter(
    ([ref]) => ref === 'mock-updateMessage',
  );
}

describe('handleTurnOutcome — terminal status mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completed → success with the streamed content', async () => {
    const ctx = createMockCtx();
    const result: RunAgentInSessionResult = {
      status: 'completed',
      exitCode: 0,
      assistantContent: 'All done.',
    };

    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), result);

    const calls = updateMessageCalls(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      messageId: 'msg_1',
      patch: {
        status: 'success',
        message: { role: 'assistant', content: 'All done.' },
      },
    });
  });

  it('cancelled with streamed content → success, content preserved (no error card)', async () => {
    const ctx = createMockCtx();
    const result: RunAgentInSessionResult = {
      status: 'cancelled',
      exitCode: null,
      assistantContent: 'Partial answer before the user hit Stop.',
    };

    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), result);

    const calls = updateMessageCalls(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      messageId: 'msg_1',
      patch: {
        status: 'success',
        message: {
          role: 'assistant',
          content: 'Partial answer before the user hit Stop.',
        },
      },
    });
  });

  it('cancelled with no renderable content → status-only failed (clean aborted bubble)', async () => {
    const ctx = createMockCtx();
    const result: RunAgentInSessionResult = {
      status: 'cancelled',
      exitCode: null,
      assistantContent: '   ',
    };

    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), result);

    const calls = updateMessageCalls(ctx);
    expect(calls).toHaveLength(1);
    // markMessageStatus: status flip only, content untouched — the UI derives
    // isAborted from failed+empty text and must NOT receive fallback prose
    // like "Agent run cancelled.".
    expect(calls[0]?.[1]).toEqual({
      messageId: 'msg_1',
      patch: { status: 'failed' },
    });
  });

  it('cancelled with undefined content → status-only failed', async () => {
    const ctx = createMockCtx();
    const result: RunAgentInSessionResult = {
      status: 'cancelled',
      exitCode: null,
    };

    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), result);

    const calls = updateMessageCalls(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      messageId: 'msg_1',
      patch: { status: 'failed' },
    });
  });

  it('failed → failed with content (real error keeps the error card)', async () => {
    const ctx = createMockCtx();
    const result: RunAgentInSessionResult = {
      status: 'failed',
      exitCode: 1,
      assistantContent: 'Traceback: something broke',
    };

    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), result);

    const calls = updateMessageCalls(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      messageId: 'msg_1',
      patch: {
        status: 'failed',
        message: { role: 'assistant', content: 'Traceback: something broke' },
      },
    });
  });

  it('failed with empty content → failed with fallback text', async () => {
    const ctx = createMockCtx();
    const result: RunAgentInSessionResult = {
      status: 'failed',
      exitCode: 1,
      assistantContent: '',
    };

    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), result);

    const calls = updateMessageCalls(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      messageId: 'msg_1',
      patch: {
        status: 'failed',
        message: { role: 'assistant', content: 'Agent run failed.' },
      },
    });
  });

  it('terminal outcomes run the finalize side-effects exactly once', async () => {
    const ctx = createMockCtx();
    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), {
      status: 'cancelled',
      exitCode: null,
    });

    const claims = ctx.runMutation.mock.calls.filter(
      ([ref]) => ref === 'mock-claimFinalize',
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]?.[1]).toEqual({ sessionId: 'sess_1', execId: 'exec_1' });
  });
});
