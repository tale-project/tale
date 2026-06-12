import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';

const mockSaveMessage = vi.fn();

vi.mock('@convex-dev/agent', () => ({
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
}));

vi.mock('../../_generated/api', () => ({
  components: {
    agent: {
      messages: {
        updateMessage: 'mock-updateMessage',
        deleteByIds: 'mock-deleteByIds',
      },
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

describe('handleTurnOutcome — steer seam segmentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveMessage.mockResolvedValue({ messageId: 'msg_new' });
  });

  function createSeamCtx() {
    const ctx = createMockCtx();
    ctx.storage.store.mockResolvedValue('storage_1');
    return ctx;
  }

  it('quiet handoff without a steer seam reuses the same message', async () => {
    const ctx = createSeamCtx();
    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), {
      status: 'continued',
      exitCode: null,
      assistantContent: '',
      lastSeq: 7,
    });

    expect(mockSaveMessage).not.toHaveBeenCalled();
    const [, , contArgs] = ctx.scheduler.runAfter.mock.calls[0] ?? [];
    expect(contArgs).toMatchObject({ assistantMessageId: 'msg_1' });
  });

  it('steer seam with an empty segment replaces the bubble (fresh below, empty deleted)', async () => {
    const ctx = createSeamCtx();
    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), {
      status: 'continued',
      exitCode: null,
      assistantContent: '',
      lastSeq: 7,
      steerSeam: true,
    });

    // Fresh pending message created — its _creationTime is AFTER the queued
    // user message, so the continuation streams below it.
    expect(mockSaveMessage).toHaveBeenCalledTimes(1);
    const deletes = ctx.runMutation.mock.calls.filter(
      ([ref]) => ref === 'mock-deleteByIds',
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.[1]).toEqual({ messageIds: ['msg_1'] });
    const [, , contArgs] = ctx.scheduler.runAfter.mock.calls[0] ?? [];
    expect(contArgs).toMatchObject({ assistantMessageId: 'msg_new' });
  });

  it('steer seam with content seals the old bubble and opens a fresh one', async () => {
    const ctx = createSeamCtx();
    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), {
      status: 'continued',
      exitCode: null,
      assistantContent: 'work so far',
      lastSeq: 7,
      steerSeam: true,
    });

    const patches = updateMessageCalls(ctx);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.[1]).toMatchObject({
      messageId: 'msg_1',
      patch: expect.objectContaining({ status: 'success' }),
    });
    expect(mockSaveMessage).toHaveBeenCalledTimes(1);
    const deletes = ctx.runMutation.mock.calls.filter(
      ([ref]) => ref === 'mock-deleteByIds',
    );
    expect(deletes).toHaveLength(0);
    const [, , contArgs] = ctx.scheduler.runAfter.mock.calls[0] ?? [];
    expect(contArgs).toMatchObject({ assistantMessageId: 'msg_new' });
  });
});
