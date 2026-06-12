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
    approvals: {
      internal_mutations: { createPlanApproval: 'mock-createPlanApproval' },
    },
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
import {
  handleTurnOutcome,
  resolvePlanText,
  type TurnContext,
} from './turn_lifecycle';

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

describe('resolvePlanText', () => {
  it('uses the ExitPlanMode capture in any mode (the gate hook stops the agent)', () => {
    expect(resolvePlanText({ planText: '# The plan' }, 'plan')).toBe(
      '# The plan',
    );
    expect(resolvePlanText({ planText: '# The plan' }, 'execute')).toBe(
      '# The plan',
    );
    expect(resolvePlanText({ planText: '# The plan' }, undefined)).toBe(
      '# The plan',
    );
  });

  it('falls back to finalText ONLY for a turn that ran in plan mode', () => {
    expect(resolvePlanText({ finalText: 'Here is my plan…' }, 'plan')).toBe(
      'Here is my plan…',
    );
    expect(resolvePlanText({ finalText: 'normal answer' }, 'execute')).toBe(
      null,
    );
    expect(resolvePlanText({ finalText: 'normal answer' }, undefined)).toBe(
      null,
    );
  });

  it('returns null for blank captures and empty results', () => {
    expect(resolvePlanText({ planText: '   ' }, 'plan')).toBe(null);
    expect(resolvePlanText({ finalText: '   ' }, 'plan')).toBe(null);
    expect(resolvePlanText({}, 'plan')).toBe(null);
  });
});

describe('handleTurnOutcome — plan-approval creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function planApprovalCalls(ctx: ReturnType<typeof createMockCtx>) {
    return ctx.runMutation.mock.calls.filter(
      ([ref]) => ref === 'mock-createPlanApproval',
    );
  }

  it('creates one approval row when a plan-mode turn captured a plan', async () => {
    const ctx = createMockCtx();
    const turn: TurnContext = { ...makeTurn(), permissionMode: 'plan' };
    await handleTurnOutcome(ctx as unknown as ActionCtx, turn, {
      status: 'completed',
      exitCode: 0,
      assistantContent: 'Plan created.',
      planText: '# Plan: do the thing',
    });

    const calls = planApprovalCalls(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toMatchObject({
      organizationId: 'org_1',
      threadId: 'thread_1',
      messageId: 'msg_1',
      agentSlug: 'claude-code',
      plan: '# Plan: do the thing',
      planSource: 'exit_plan_mode',
    });
  });

  it('uses the finalText fallback (planSource final_text) for a plan turn without ExitPlanMode', async () => {
    const ctx = createMockCtx();
    const turn: TurnContext = { ...makeTurn(), permissionMode: 'plan' };
    await handleTurnOutcome(ctx as unknown as ActionCtx, turn, {
      status: 'completed',
      exitCode: 0,
      finalText: 'Step 1 … Step 2 …',
      assistantContent: 'Step 1 … Step 2 …',
    });

    const calls = planApprovalCalls(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toMatchObject({ planSource: 'final_text' });
  });

  it('creates no row for an execute-mode turn without a capture, nor on cancel', async () => {
    const ctx = createMockCtx();
    await handleTurnOutcome(ctx as unknown as ActionCtx, makeTurn(), {
      status: 'completed',
      exitCode: 0,
      finalText: 'normal answer',
      assistantContent: 'normal answer',
    });
    expect(planApprovalCalls(ctx)).toHaveLength(0);

    const cancelled: TurnContext = { ...makeTurn(), permissionMode: 'plan' };
    await handleTurnOutcome(ctx as unknown as ActionCtx, cancelled, {
      status: 'cancelled',
      exitCode: null,
      planText: '# captured before Stop',
    });
    expect(planApprovalCalls(ctx)).toHaveLength(0);
  });

  it('still creates the row on a max-turns/failed end (captured plan is reviewable)', async () => {
    const ctx = createMockCtx();
    const turn: TurnContext = { ...makeTurn(), permissionMode: 'plan' };
    await handleTurnOutcome(ctx as unknown as ActionCtx, turn, {
      status: 'failed',
      exitCode: 1,
      assistantContent: 'ran out of turns',
      planText: '# Plan from a noisy end',
    });
    expect(planApprovalCalls(ctx)).toHaveLength(1);
  });

  it('a createPlanApproval failure never skips finalize', async () => {
    const ctx = createMockCtx();
    ctx.runMutation.mockImplementation((ref: unknown) => {
      if (ref === 'mock-createPlanApproval') {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve(true);
    });
    const turn: TurnContext = { ...makeTurn(), permissionMode: 'plan' };
    await handleTurnOutcome(ctx as unknown as ActionCtx, turn, {
      status: 'completed',
      exitCode: 0,
      assistantContent: 'Plan created.',
      planText: '# Plan',
    });

    const claims = ctx.runMutation.mock.calls.filter(
      ([ref]) => ref === 'mock-claimFinalize',
    );
    expect(claims).toHaveLength(1);
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
