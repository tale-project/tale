// Regression for the 90s-per-reply stall: a hold-stdin harness (claude-code)
// never exits after its reply — it waits on stdin for the next message — and
// the drain used to resolve only on process exit, so EVERY turn sat out the
// full DRAIN_WINDOW_MS (observed: a 3s answer surfacing after ~95s). The
// window must be cut shortly after the parser sees `turn-ended`, the
// lingering process reaped, and the grace timer cleared once an exec exits on
// its own.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockDrain = vi.fn();
const mockCancel = vi.fn();
vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) => mockDrain(...args),
  sessionCancelExec: (...args: unknown[]) => mockCancel(...args),
  sessionStageFiles: vi.fn(),
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));

import type { HarnessTimelinePart } from './external_turn_shared';
import {
  drainHarnessWindow,
  STREAM_TEXT_THROTTLE_MS,
  TURN_ENDED_EXIT_GRACE_MS,
} from './external_turn_shared';

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

/** A tool call with no assistant text around it — the shape of a tool-heavy
 * stretch (reading files, running commands) where the agent says nothing. */
const TOOL_USE_LINE = `${JSON.stringify({
  type: 'assistant',
  message: {
    id: 'msg_t1',
    model: 'z-ai/glm-5.2',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Bash',
        input: { command: 'ls /agent/workspace/input' },
      },
    ],
  },
})}\n`;

const TOOL_RESULT_LINE = `${JSON.stringify({
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: 'INV-1.pdf',
        is_error: false,
      },
    ],
  },
})}\n`;

type DrainCallbacks = { onStdout?: (text: string) => void };

describe('drainHarnessWindow — turn-ended cut on a lingering exec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('cuts the window at turn-ended when the exec lingers and reaps it', async () => {
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

    const window = drainHarnessWindow({
      sessionId: 'session_1',
      execId: 'exec_1',
      harness: 'claude-code',
    });
    await vi.advanceTimersByTimeAsync(TURN_ENDED_EXIT_GRACE_MS);
    const result = await window;

    expect(result.kind).toBe('terminal');
    if (result.kind !== 'terminal') throw new Error('unreachable');
    expect(result.exited).toBe(false);
    expect(result.ended?.isError).toBe(false);
    // The harness announced its conversation id — the restart-steering
    // lane's --resume handle, persisted onto the op row by the hosts.
    expect(result.agentSessionId).toBe('sess-resume-1');
    // The lingering process is reaped so it can't hold the session.
    expect(mockCancel).toHaveBeenCalledWith('session_1', 'exec_1');
  });

  it('leaves a naturally-exiting harness alone: no linger reap, no stray grace timer', async () => {
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

    const result = await drainHarnessWindow({
      sessionId: 'session_1',
      execId: 'exec_1',
      harness: 'claude-code',
    });

    expect(result.kind).toBe('terminal');
    if (result.kind !== 'terminal') throw new Error('unreachable');
    expect(result.exited).toBe(true);
    expect(mockCancel).not.toHaveBeenCalled();
    // The turn-ended grace timer must be cleared once the exec exits on its
    // own — a leaked timer would abort a signal nothing listens to, but more
    // importantly it would keep the action's event loop dirty.
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Regression for the frozen run log: the automation lane passes BOTH sinks,
// and the timeline used to ride the text guard — so a tool-heavy stretch
// (which emits no assistant text) wrote nothing to the op row, the run dialog
// sat on "starting up in the sandbox…", and the whole backlog flooded in at
// once with the agent's next text block. The timeline must advance on tool
// activity alone.
describe('drainHarnessWindow — live timeline on tool-only activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('emits the timeline for tool activity before any assistant text exists', async () => {
    const onText = vi.fn<(text: string) => void>();
    const onTimeline = vi.fn<(parts: HarnessTimelinePart[]) => void>();
    mockDrain.mockImplementation(
      (
        _sessionId: unknown,
        _body: unknown,
        _signal: unknown,
        callbacks: DrainCallbacks,
      ) => {
        callbacks.onStdout?.(TOOL_USE_LINE);
        return Promise.resolve(TERMINAL);
      },
    );

    const window = await drainHarnessWindow({
      sessionId: 'session_1',
      execId: 'exec_1',
      harness: 'claude-code',
      onText,
      onTimeline,
    });

    expect(window.kind).toBe('terminal');
    expect(onText).not.toHaveBeenCalled();
    expect(onTimeline).toHaveBeenCalledTimes(1);
    expect(onTimeline.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        type: 'tool-Bash',
        state: 'input-available',
        toolCallId: 'toolu_1',
      }),
    ]);
  });

  it('keeps advancing the timeline between text blocks (tool results alone)', async () => {
    const onText = vi.fn<(text: string) => void>();
    const onTimeline = vi.fn<(parts: HarnessTimelinePart[]) => void>();
    let emit: ((chunk: string) => void) | undefined;
    let finish: (() => void) | undefined;
    mockDrain.mockImplementation(
      (
        _sessionId: unknown,
        _body: unknown,
        _signal: unknown,
        callbacks: DrainCallbacks,
      ) => {
        emit = callbacks.onStdout;
        return new Promise((resolve) => {
          finish = () => resolve(TERMINAL);
        });
      },
    );

    const windowPromise = drainHarnessWindow({
      sessionId: 'session_1',
      execId: 'exec_1',
      harness: 'claude-code',
      onText,
      onTimeline,
    });
    emit?.(TEXT_LINE);
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onTimeline).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(STREAM_TEXT_THROTTLE_MS + 50);
    emit?.(TOOL_USE_LINE + TOOL_RESULT_LINE);

    // No new text arrived — the tool transcript must still move.
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onTimeline).toHaveBeenCalledTimes(2);
    expect(onTimeline.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({
        type: 'tool-Bash',
        state: 'output-available',
        toolCallId: 'toolu_1',
      }),
    ]);

    finish?.();
    await expect(windowPromise).resolves.toMatchObject({ kind: 'terminal' });
  });
});
