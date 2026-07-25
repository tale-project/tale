// Regression for the 90s-per-reply stall: a hold-stdin harness (claude-code)
// never exits after its reply — it waits on stdin for the next message — and
// the drain used to resolve only on process exit, so EVERY turn sat out the
// full DRAIN_WINDOW_MS (observed: a 3s answer surfacing after ~95s). The
// window must be cut shortly after the parser sees `turn-ended`, and the
// accumulating reply text must stream into the assistant message mid-window
// instead of landing once at the window boundary.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockDrain = vi.fn();
const mockCancel = vi.fn();
vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) => mockDrain(...args),
  sessionCancelExec: (...args: unknown[]) => mockCancel(...args),
  sessionCreate: vi.fn(),
  sessionIsAlive: vi.fn(),
  sessionStageFiles: vi.fn(),
  SessionDuplicateError: class SessionDuplicateError extends Error {},
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: vi.fn(),
}));
vi.mock('../node_only/sandbox/llm_gateway_admin', () => ({
  getVirtualKeySpendCents: vi.fn(),
  revokeVirtualKey: vi.fn(),
}));

import { getFunctionName } from 'convex/server';

import { internal } from '../_generated/api';
import {
  drainExternalTurnWindow,
  TURN_ENDED_EXIT_GRACE_MS,
} from './external_turn_shared';

const SCOPE = {
  organizationId: 'org_1',
  threadId: 'thread_1',
  userId: 'user_1',
};

const WINDOW_ARGS = {
  scope: SCOPE,
  sessionId: 'session_1',
  execId: 'exec_1',
  messageId: 'msg_1' as never,
  harness: 'claude-code',
  providerSlug: 'openrouter',
  gatewayModel: 'z-ai/glm-5.2',
};

const TERMINAL = {
  status: 'completed' as const,
  exitCode: 0,
  durationMs: 5,
  stdoutBase64: '',
  stderrBase64: '',
  truncated: { stdout: false, stderr: false },
};

/** One claude-code stream-json line for an assistant text block. */
const TEXT_LINE = `${JSON.stringify({
  type: 'assistant',
  message: {
    id: 'msg_a1',
    model: 'z-ai/glm-5.2',
    content: [{ type: 'text', text: 'Hello! How can I help?' }],
    usage: { input_tokens: 10, output_tokens: 6 },
  },
})}\n`;

/** The end-of-turn `result` line — the harness's reply is complete here even
 * though the held-open process never exits. */
const RESULT_LINE = `${JSON.stringify({
  type: 'result',
  subtype: 'success',
  session_id: 'sess-resume-1',
  result: 'Hello! How can I help?',
  is_error: false,
  duration_ms: 2900,
})}\n`;

type DrainCallbacks = { onStdout?: (text: string) => void };

function createCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(null),
    // finalize reads the op row; null = degraded pre-op edge, which settles
    // without a VK revoke and never blocks these tests.
    runQuery: vi.fn().mockResolvedValue(null),
    runAction: vi.fn().mockResolvedValue(null),
  };
}

function mutationNames(ctx: ReturnType<typeof createCtx>): string[] {
  return ctx.runMutation.mock.calls.map((call) =>
    getFunctionName(call[0] as Parameters<typeof getFunctionName>[0]),
  );
}

describe('drainExternalTurnWindow — turn-ended cut + mid-window streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('cuts the window at turn-ended when the exec lingers, reaps it, and finalizes', async () => {
    const ctx = createCtx();
    mockCancel.mockResolvedValue(undefined);
    mockDrain.mockImplementation(
      (
        _sessionId: unknown,
        _body: unknown,
        signal: AbortSignal,
        callbacks: DrainCallbacks,
      ) => {
        callbacks.onStdout?.(TEXT_LINE + RESULT_LINE);
        // Hold-stdin harness: the reply is done but the process never exits —
        // the drain only ever ends by the caller's signal.
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('drain aborted', 'AbortError')),
          );
        });
      },
    );

    const window = drainExternalTurnWindow(ctx as never, WINDOW_ARGS);
    await vi.advanceTimersByTimeAsync(TURN_ENDED_EXIT_GRACE_MS);
    const outcome = await window;

    expect(outcome).toEqual({ kind: 'done' });
    // The lingering process is reaped so it can't hold the session.
    expect(mockCancel).toHaveBeenCalledWith('session_1', 'exec_1');
    const called = mutationNames(ctx);
    expect(called).toContain(
      getFunctionName(internal.chat.messages.finalizeAssistantMessageInternal),
    );
    expect(called).toContain(
      getFunctionName(internal.chat.generations.endGenerationInternal),
    );
  });

  it('streams the reply text into the message BEFORE the drain settles', async () => {
    const ctx = createCtx();
    const order: string[] = [];
    ctx.runMutation.mockImplementation((ref: unknown) => {
      order.push(getFunctionName(ref as Parameters<typeof getFunctionName>[0]));
      return Promise.resolve(null);
    });
    mockDrain.mockImplementation(
      (
        _sessionId: unknown,
        _body: unknown,
        _signal: unknown,
        callbacks: DrainCallbacks,
      ) => {
        callbacks.onStdout?.(TEXT_LINE + RESULT_LINE);
        return Promise.resolve().then(() => {
          order.push('drain-settled');
          return TERMINAL;
        });
      },
    );

    const outcome = await drainExternalTurnWindow(ctx as never, WINDOW_ARGS);

    expect(outcome).toEqual({ kind: 'done' });
    const setText = getFunctionName(
      internal.chat.messages.setAssistantTextInternal,
    );
    expect(order.indexOf(setText)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(setText)).toBeLessThan(order.indexOf('drain-settled'));
  });

  it('leaves a naturally-exiting harness alone: no linger reap, no stray grace timer', async () => {
    const ctx = createCtx();
    mockDrain.mockImplementation(
      (
        _sessionId: unknown,
        _body: unknown,
        _signal: unknown,
        callbacks: DrainCallbacks,
      ) => {
        callbacks.onStdout?.(TEXT_LINE + RESULT_LINE);
        return Promise.resolve(TERMINAL);
      },
    );

    const outcome = await drainExternalTurnWindow(ctx as never, WINDOW_ARGS);

    expect(outcome).toEqual({ kind: 'done' });
    expect(mockCancel).not.toHaveBeenCalled();
    // The turn-ended grace timer must be cleared once the exec exits on its
    // own — a leaked timer would abort a signal nothing listens to, but more
    // importantly it would keep the action's event loop dirty.
    expect(vi.getTimerCount()).toBe(0);
  });
});
