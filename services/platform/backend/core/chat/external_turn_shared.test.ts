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
 *
 * And how a terminal window classifies: a turn that ended cleanly with
 * nothing at all from the model (live: a serving cluster that failed
 * mid-prefill answered an empty 200) is a failure, while a turn that only
 * called tools, only reasoned, or only reported output tokens is not.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFixture } from '../../../lib/harnesses/test-helpers';

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

const {
  drainHarnessWindow,
  classifyHarnessEnd,
  isSpendRefusal,
  spendRefusalReason,
} = await import('./external_turn_shared');

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

/** The reason an empty answer settles with — the words a run shows. */
const EMPTY_ANSWER =
  'The model returned an empty answer, so the agent did nothing this turn.';

type TerminalWindow = Extract<
  Awaited<ReturnType<typeof drainHarnessWindow>>,
  { kind: 'terminal' }
>;

/** A terminal window of a turn that ended cleanly, with nothing else seen. */
function cleanEnd(overrides: Partial<TerminalWindow> = {}): TerminalWindow {
  return {
    kind: 'terminal',
    text: '',
    timeline: [],
    ended: { type: 'turn-ended', status: 'completed' },
    exited: false,
    ...overrides,
  };
}

describe('classifyHarnessEnd', () => {
  beforeEach(() => {
    transport.stdout = '';
    transport.cancelled = [];
    transport.exitAfterStdout = false;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  /** A captured Claude Code turn through the real drain and parser. */
  async function drainCapture(
    name: string,
    opts: { exits?: boolean } = {},
  ): Promise<TerminalWindow> {
    transport.stdout = `${readFixture('claude-code', name)}\n`;
    transport.exitAfterStdout = opts.exits ?? true;
    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: `exec-${name}`,
      harness: 'claude-code',
      windowMs: 10_000,
    });
    if (result.kind !== 'terminal') {
      throw new Error(`expected a terminal window, got ${result.kind}`);
    }
    return result;
  }

  it('fails a turn whose model answered nothing (the live empty 200)', async () => {
    // As it ran: the held-stdin CLI lingers after its result, so the turn
    // ends on the grace cut, not on an exit.
    const result = await drainCapture('empty-answer-turn', { exits: false });

    expect(result.exited).toBe(false);
    expect(result.ended?.isError).toBe(false);
    expect(classifyHarnessEnd(result)).toEqual({
      errored: true,
      reason: EMPTY_ANSWER,
      emptyAnswer: true,
    });
    expect(transport.cancelled).toEqual(['exec-empty-answer-turn']);
  });

  it('keeps a reasoning-only turn: the result counts its tokens', async () => {
    const result = await drainCapture('thinking-only-turn');

    // Nothing visible, and the only streamed usage says 0.
    expect(result.text).toBe('');
    expect(result.timeline).toEqual([]);
    expect(result.outputTokens ?? 0).toBe(0);
    expect(classifyHarnessEnd(result)).toEqual({
      errored: false,
      emptyAnswer: false,
    });
  });

  it('keeps a turn that reported output tokens but showed nothing', async () => {
    const result = await drainCapture('token-only-turn');

    expect(classifyHarnessEnd(result)).toEqual({
      errored: false,
      emptyAnswer: false,
    });
  });

  it('keeps a real turn that called a tool and reported', async () => {
    const result = await drainCapture('plan-mode-turn');

    expect(classifyHarnessEnd(result)).toEqual({
      errored: false,
      emptyAnswer: false,
    });
  });

  it('adds up the output tokens a window’s usage reports carry', async () => {
    // Codex reports a reasoning-only turn as a raw item plus the turn's
    // usage — no text, no tool call, no totals on its end.
    transport.stdout = ndjson([
      { type: 'thread.started', thread_id: 'codex-thread' },
      { type: 'turn.started' },
      {
        type: 'item.completed',
        item: { id: 'rs_1', type: 'reasoning', summary: [] },
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 900,
          cached_input_tokens: 0,
          output_tokens: 12,
          reasoning_output_tokens: 12,
        },
      },
    ]);
    transport.exitAfterStdout = true;

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'codex-reasoning',
      harness: 'codex',
      windowMs: 5_000,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.timeline).toEqual([]);
      expect(result.ended?.usageTotals).toBeUndefined();
      expect(result.outputTokens).toBe(12);
      expect(classifyHarnessEnd(result).errored).toBe(false);
    }
  });

  it('fails a clean end that saw nothing at all', () => {
    expect(classifyHarnessEnd(cleanEnd())).toEqual({
      errored: true,
      reason: EMPTY_ANSWER,
      emptyAnswer: true,
    });
    // Zero totals are still nothing.
    expect(
      classifyHarnessEnd(
        cleanEnd({
          ended: {
            type: 'turn-ended',
            status: 'completed',
            isError: false,
            usageTotals: { inputTokens: 0, outputTokens: 0 },
          },
          outputTokens: 0,
        }),
      ).errored,
    ).toBe(true);
    // Blank text is not an answer.
    expect(
      classifyHarnessEnd(
        cleanEnd({
          text: '\n\n',
          timeline: [{ type: 'text', text: '\n\n' }],
          ended: { type: 'turn-ended', status: 'completed', finalText: ' ' },
        }),
      ).emptyAnswer,
    ).toBe(true);
  });

  it('keeps a turn that only called tools and ended without a summary', () => {
    expect(
      classifyHarnessEnd(
        cleanEnd({
          timeline: [
            {
              type: 'tool-Write',
              state: 'output-available',
              toolCallId: 'toolu_1',
              input: { file_path: '/agent/output/profile.yaml' },
            },
          ],
        }),
      ),
    ).toEqual({ errored: false, emptyAnswer: false });
  });

  it('keeps a turn with an answer, streamed or only on its end', () => {
    expect(
      classifyHarnessEnd(
        cleanEnd({
          text: 'Nothing to change.',
          timeline: [{ type: 'text', text: 'Nothing to change.' }],
        }),
      ).errored,
    ).toBe(false);
    expect(
      classifyHarnessEnd(
        cleanEnd({
          ended: {
            type: 'turn-ended',
            status: 'completed',
            finalText: 'Nothing to change.',
          },
        }),
      ).errored,
    ).toBe(false);
  });

  it('keeps a turn whose model reported output tokens', () => {
    expect(
      classifyHarnessEnd(
        cleanEnd({
          ended: {
            type: 'turn-ended',
            status: 'completed',
            usageTotals: { inputTokens: 900, outputTokens: 1 },
          },
        }),
      ).errored,
    ).toBe(false);
    expect(classifyHarnessEnd(cleanEnd({ outputTokens: 3 })).errored).toBe(
      false,
    );
  });

  it('leaves a harness-reported error to the harness’s own words', () => {
    expect(
      classifyHarnessEnd(
        cleanEnd({
          ended: { type: 'turn-ended', status: 'completed', isError: true },
        }),
      ),
    ).toEqual({ errored: true, emptyAnswer: false });
  });

  it('judges only a completed end as an answer', () => {
    expect(
      classifyHarnessEnd(
        cleanEnd({ ended: { type: 'turn-ended', status: 'max-turns' } }),
      ),
    ).toEqual({ errored: false, emptyAnswer: false });
  });

  it('still names a crash without a turn end', () => {
    const crashed = {
      text: '',
      timeline: [],
      exited: true,
      execResult: {
        status: 'failed' as const,
        exitCode: 137,
        durationMs: 5,
        stdoutBase64: '',
        stderrBase64: '',
        truncated: { stdout: false, stderr: false },
      },
    };
    expect(classifyHarnessEnd(crashed)).toEqual({
      errored: true,
      reason:
        'The harness exited unexpectedly (exit code 137) without completing the turn.',
      emptyAnswer: false,
    });
    expect(
      classifyHarnessEnd({
        ...crashed,
        execResult: { ...crashed.execResult, errorMessage: 'OOM killed' },
      }).reason,
    ).toBe('The harness stopped: OOM killed');
  });
});

describe('spend refusal (402) classification', () => {
  it('reads a 402 as the turn’s money being gone, and nothing else', () => {
    // The gateway's virtual-key budget refusal and a vendor's own payment
    // refusal both answer 402; a retry meets the same answer, so the hosts
    // settle it as `budget_exceeded` instead of re-kicking a resume that
    // dies on its second call.
    expect(isSpendRefusal({ apiErrorStatus: 402 })).toBe(true);
    expect(isSpendRefusal({ apiErrorStatus: 429 })).toBe(false);
    expect(isSpendRefusal({ apiErrorStatus: 401 })).toBe(false);
    expect(isSpendRefusal({})).toBe(false);
    expect(isSpendRefusal(undefined)).toBe(false);
  });

  it('names the exhausted allowance and keeps the harness’s own line as the detail', () => {
    expect(
      spendRefusalReason(
        'API Error: 402 Model-level budget exceeded (virtual key scope): budget exceeded: 1.5618 >= 1.5100 dollars',
      ),
    ).toBe(
      "the turn's spend allowance was exhausted (API status 402): API Error: 402 Model-level budget exceeded (virtual key scope): budget exceeded: 1.5618 >= 1.5100 dollars",
    );
    expect(spendRefusalReason('')).toBe(
      "the turn's spend allowance was exhausted (API status 402)",
    );
    expect(spendRefusalReason(undefined)).toBe(
      "the turn's spend allowance was exhausted (API status 402)",
    );
    // A long transcript keeps only its tail — the run row is a status row.
    const long = `${'x'.repeat(400)}API Error: 402 tail`;
    const reason = spendRefusalReason(long);
    expect(reason.endsWith('API Error: 402 tail')).toBe(true);
    expect(reason.length).toBeLessThan(400);
  });
});
