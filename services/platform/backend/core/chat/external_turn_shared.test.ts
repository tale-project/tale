/**
 * The drain window's end-of-turn rules, driven through the REAL parsers and
 * harness registry with only the sandbox transport replaced:
 *
 *  - a window that elapses under a live exec is not an EOF — a parser that
 *    holds a result until the stream ends (pi) must not finalize it, or a
 *    mid-tool stop reads as a completed turn and the process is cut under it;
 *  - a `turn-ended` whose background-task ledger is still open is a lingering
 *    turn, not a finished one — the process stays alive until the ledger
 *    settles (the `types.ts` `task-started`/`task-settled` contract);
 *  - a real exit still finalizes a held result, and a plain hold-stdin turn
 *    with no background work is still cut and reaped after the grace.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  stdout: '' as string,
  cancelled: [] as string[],
  exitAfterStdout: false,
}));

vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  SessionNotFoundError: class SessionNotFoundError extends Error {},
  sessionStageFiles: async () => ({ staged: [], skipped: [] }),
  sessionCancelExec: async (_sessionId: string, execId: string) => {
    transport.cancelled.push(execId);
    return true;
  },
  drainSessionExecResilient: async (
    _sessionId: string,
    _body: unknown,
    signal: AbortSignal,
    callbacks: { onStdout?: (chunk: string) => void },
  ) => {
    callbacks.onStdout?.(transport.stdout);
    if (transport.exitAfterStdout) return { exitCode: 0 };
    // A live exec: the drain only ends when the window (or the cut) aborts.
    await new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
    throw new Error('unreachable');
  },
}));

const { drainHarnessWindow, classifyHarnessEnd } =
  await import('./external_turn_shared');

/** One NDJSON stream from event objects. */
function ndjson(lines: Array<Record<string, unknown>>): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

const PI_MID_TOOL = ndjson([
  { type: 'session', id: 'pi-live-session', version: 3 },
  {
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'toolUse',
      content: [
        {
          type: 'toolCall',
          id: 'slow-tool',
          name: 'bash',
          arguments: { command: 'slow build' },
        },
      ],
    },
  },
  {
    type: 'tool_execution_start',
    toolCallId: 'slow-tool',
    toolName: 'bash',
    args: { command: 'slow build' },
  },
]);

const CLAUDE_INIT = { type: 'system', subtype: 'init', session_id: 'claude-1' };
const CLAUDE_TASK_STARTED = {
  type: 'system',
  subtype: 'task_started',
  task_id: 'bg-report',
  description: 'Generate the report asynchronously',
};
const CLAUDE_RESULT = {
  type: 'result',
  subtype: 'success',
  session_id: 'claude-1',
  result: 'The report is being generated in the background.',
};
const CLAUDE_TASK_SETTLED = {
  type: 'system',
  subtype: 'task_notification',
  task_id: 'bg-report',
  status: 'completed',
};

describe('drainHarnessWindow end-of-turn rules', () => {
  beforeEach(() => {
    transport.stdout = '';
    transport.cancelled = [];
    transport.exitAfterStdout = false;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('keeps a pi turn running when the window elapses mid-tool', async () => {
    transport.stdout = PI_MID_TOOL;

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'slow-pi',
      harness: 'pi',
      windowMs: 50,
    });

    expect(result.kind).toBe('running');
    expect(transport.cancelled).toEqual([]);
    if (result.kind === 'running') {
      // The window still reports what it saw: the tool call is on the timeline.
      expect(result.timeline.map((part) => part.type)).toEqual(['tool-bash']);
      expect(result.agentSessionId).toBe('pi-live-session');
    }
  });

  it('still finalizes a held pi result on a real exit', async () => {
    transport.stdout = ndjson([
      { type: 'session', id: 'pi-live-session', version: 3 },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'gateway refused the call',
          content: [],
        },
      },
      { type: 'agent_end' },
    ]);
    transport.exitAfterStdout = true;

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'dead-pi',
      harness: 'pi',
      windowMs: 5_000,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.exited).toBe(true);
      expect(result.ended?.status).toBe('error');
      expect(classifyHarnessEnd(result).errored).toBe(true);
    }
    // The process exited on its own — nothing to reap.
    expect(transport.cancelled).toEqual([]);
  });

  it('keeps a claude turn running while a background task is open', async () => {
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      CLAUDE_RESULT,
    ]);

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'bg-claude',
      harness: 'claude-code',
      windowMs: 50,
    });

    expect(result.kind).toBe('running');
    expect(transport.cancelled).toEqual([]);
  });

  it('ends a claude turn once its background task settles', async () => {
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      CLAUDE_RESULT,
      CLAUDE_TASK_SETTLED,
    ]);

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'bg-claude',
      harness: 'claude-code',
      // Longer than the turn-ended grace, so the cut (not the window) ends it.
      windowMs: 10_000,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.exited).toBe(false);
      expect(result.ended?.status).toBe('completed');
      expect(classifyHarnessEnd(result).errored).toBe(false);
    }
    // The lingering hold-stdin process is reaped exactly once.
    expect(transport.cancelled).toEqual(['bg-claude']);
  });

  it('cuts and reaps a plain hold-stdin turn with no background work', async () => {
    transport.stdout = ndjson([CLAUDE_INIT, CLAUDE_RESULT]);

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'plain-claude',
      harness: 'claude-code',
      windowMs: 10_000,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.exited).toBe(false);
      expect(result.ended?.finalText).toBe(
        'The report is being generated in the background.',
      );
    }
    expect(transport.cancelled).toEqual(['plain-claude']);
  });
});
