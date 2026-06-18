import { describe, it, expect, vi } from 'vitest';

// The module wraps its handler in `internalAction` and pulls in Convex /
// agent-component deps at import time; stub them so we can unit-test the pure
// success-decision helper in isolation.
vi.mock('../../_generated/api', () => ({ internal: {}, components: {} }));
vi.mock('../../_generated/server', () => ({
  internalAction: (def: unknown) => def,
}));
vi.mock('../../node_only/sandbox/helpers/session_client', () => ({
  sessionCancelExec: vi.fn(),
  sessionExecStatus: vi.fn(),
}));
vi.mock('./turn_lifecycle', () => ({
  finalizeTurnSideEffects: vi.fn(),
  markMessageStatus: vi.fn(),
}));

import { reapedTurnSucceeded } from './recover_external_agent_turns';

describe('reapedTurnSucceeded', () => {
  it('agent self-reported completed → success', () => {
    expect(
      reapedTurnSucceeded({
        agentResultStatus: 'completed',
        liveness: { state: 'gone' },
        progressText: undefined,
      }),
    ).toBe(true);
  });

  it('process exited cleanly (code 0) → success', () => {
    expect(
      reapedTurnSucceeded({
        agentResultStatus: undefined,
        liveness: { state: 'exited', exitCode: 0 },
        progressText: undefined,
      }),
    ).toBe(true);
  });

  it('reaped after streaming a visible answer (no self-reported result) → success', () => {
    // The reported bug: a turn the user already got an answer for, reaped while
    // lingering (non-zero exit), must NOT surface "Something went wrong".
    expect(
      reapedTurnSucceeded({
        agentResultStatus: undefined,
        liveness: { state: 'exited', exitCode: 137 },
        progressText: 'PR #1898 is green and mergeable. Stopping the poll.',
      }),
    ).toBe(true);
  });

  it('gone with no self-reported result and no streamed output → failed', () => {
    expect(
      reapedTurnSucceeded({
        agentResultStatus: undefined,
        liveness: { state: 'gone' },
        progressText: '',
      }),
    ).toBe(false);
  });

  it('whitespace-only output does not count as renderable → failed', () => {
    expect(
      reapedTurnSucceeded({
        agentResultStatus: undefined,
        liveness: { state: 'gone' },
        progressText: '   \n  ',
      }),
    ).toBe(false);
  });

  it('agent self-reported a real error → failed even with streamed output (verdict wins)', () => {
    expect(
      reapedTurnSucceeded({
        agentResultStatus: 'error_during_execution',
        liveness: { state: 'exited', exitCode: 1 },
        progressText: 'partial work before the crash…',
      }),
    ).toBe(false);
  });
});
