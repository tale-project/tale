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
 *  - a real exit still finalizes a held result;
 *  - a hold-stdin turn with no background work gets its stdin closed and
 *    ends on the CLI's own exit, and is cut and reaped after the grace only
 *    when it does not exit.
 *
 * And how a terminal window classifies: a turn that ended cleanly with
 * nothing at all from the model (live: a serving cluster that failed
 * mid-prefill answered an empty 200) is a failure, while a turn that only
 * called tools, only reasoned, or only reported output tokens is not.
 *
 * And how a window meets a spawner it cannot reach: it ends `running` with
 * the outage's start rather than failing the turn, keeps an outage that
 * outlasts it measured from where it began, and clears it once the stream
 * flows again.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ExecReplay,
  ReplayBudget,
} from '../../../../sandbox-runtime/daemon/src/exec-replay';
import { readFixture } from '../../../lib/harnesses/test-helpers';
import type { HarnessExec } from '../../../lib/harnesses/types';

const transport = vi.hoisted(() => ({
  replayComplete: true,
  stdout: '' as string,
  stderr: '' as string,
  replayTail: '' as string,
  cancelled: [] as string[],
  exitAfterStdout: false,
  exitCode: 0,
  errorCode: undefined as string | undefined,
  protocolFailure: false,
  checkpoint: null as { seq: number; state: unknown } | null,
  gapCheckpoint: null as { seq: number; state: unknown } | null,
  gapAfterStdout: false,
  checkpointAfterGap: 'none' as 'none' | 'missing' | 'failed' | 'newer',
  checkpointRecovery: 'missing' as 'missing' | 'failed' | 'newer',
  recoveryCheckpoint: null as { seq: number; state: unknown } | null,
  gapToSeq: 5,
  stdoutDelayMs: 0,
  Gap: class ExecReplayGapError extends Error {
    readonly toSeq: number;
    constructor(message: string, toSeq: number) {
      super(message);
      this.toSeq = toSeq;
    }
  },
  resumedAt: [] as number[],
  stdinWrites: [] as Array<{ execId: string; eof?: boolean }>,
  /** How the live exec answers a stdin EOF: by exiting, by ignoring it, or
   * the write itself failing. */
  onEof: 'exit' as 'exit' | 'ignore' | 'fail',
  exitOnEof: undefined as (() => void) | undefined,
  /** Every session operation in order, as `verb:detail` lines. */
  sessionOps: [] as string[],
  deleteFailure: undefined as Error | undefined,
  deleteSkips: [] as Array<{ path: string; reason: string }>,
  /** A failure the checkpoint read throws instead of answering. */
  checkpointFailure: undefined as Error | undefined,
  /** What the drain tells the window about its stream before it follows
   * the exec: nothing, a stream lost to the transport, or one that flows. */
  contactEvent: 'none' as 'none' | 'lost' | 'attached',
}));

vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  SessionNotFoundError: class SessionNotFoundError extends Error {},
  // The real classifier reads its own error classes; this transport marks
  // an unreachable spawner by name.
  isSpawnerTransportFailure: (error: unknown) =>
    error instanceof Error && error.name === 'SpawnerUnreachableError',
  ExecReplayGapError: transport.Gap,
  ExecStreamProtocolError: class ExecStreamProtocolError extends Error {},
  sessionStageFiles: async (
    _sessionId: string,
    files: Array<{ path: string }>,
  ) => {
    transport.sessionOps.push(`stage:${files.map((f) => f.path).join(',')}`);
    return { staged: [], skipped: [] };
  },
  sessionDeleteFiles: async (_sessionId: string, paths: string[]) => {
    transport.sessionOps.push(`delete:${paths.join(',')}`);
    if (transport.deleteFailure !== undefined) throw transport.deleteFailure;
    return { deleted: paths, skipped: transport.deleteSkips };
  },
  sessionGetExecCheckpoint: async () => {
    if (transport.checkpointFailure !== undefined)
      throw transport.checkpointFailure;
    if (transport.checkpointAfterGap !== 'none') {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      if (transport.checkpointAfterGap === 'failed')
        throw new Error('checkpoint read failed');
      return transport.checkpointAfterGap === 'newer'
        ? transport.recoveryCheckpoint
        : null;
    }
    return transport.checkpoint;
  },
  sessionPutExecCheckpoint: async (
    _sessionId: string,
    _execId: string,
    checkpoint: { seq: number; state: unknown },
  ) => {
    // Match the real client: an oversized exact answer leaves replay unacknowledged.
    if (Buffer.byteLength(JSON.stringify(checkpoint)) <= 1024 * 1024)
      transport.checkpoint = JSON.parse(JSON.stringify(checkpoint));
  },
  sessionCancelExec: async (_sessionId: string, execId: string) => {
    transport.cancelled.push(execId);
    return true;
  },
  sessionWriteExecStdin: async (
    _sessionId: string,
    execId: string,
    write: { dataBase64?: string; eof?: boolean },
  ) => {
    transport.stdinWrites.push({ execId, eof: write.eof });
    if (transport.onEof === 'fail') throw new Error('spawner unreachable');
    // Only the exec live at the write exits; a write after the drain ended
    // must not end the next test's exec.
    const exit = transport.exitOnEof;
    if (write.eof === true && transport.onEof === 'exit' && exit !== undefined)
      setTimeout(exit, 20);
    return { ok: true };
  },
  drainSessionExecResilient: async (
    _sessionId: string,
    _body: unknown,
    signal: AbortSignal,
    callbacks: {
      onStdout?: (chunk: string) => void;
      onStderr?: (chunk: string) => void;
      onReplayStarted?: () => void;
      onReplayComplete?: () => void;
    },
    opts: {
      cursor: { lastSeq: number };
      resumeSinceSeq?: number;
      contact?: { onAttached(): void; onLost(error: unknown): void };
    },
  ) => {
    if (signal.aborted) throw signal.reason;
    if (opts.resumeSinceSeq === undefined) transport.sessionOps.push('launch');
    if (transport.contactEvent === 'lost')
      opts.contact?.onLost(new Error('connect ECONNREFUSED'));
    if (transport.contactEvent === 'attached') opts.contact?.onAttached();
    callbacks.onReplayStarted?.();
    if (opts.resumeSinceSeq !== undefined)
      transport.resumedAt.push(opts.resumeSinceSeq);
    if (transport.gapCheckpoint !== null) {
      transport.checkpoint = transport.gapCheckpoint;
      transport.gapCheckpoint = null;
      throw new transport.Gap(
        'checkpoint advanced before attach',
        transport.gapToSeq,
      );
    }
    if (transport.stdoutDelayMs > 0)
      await new Promise((resolve) =>
        setTimeout(resolve, transport.stdoutDelayMs),
      );
    if (transport.stdout !== '') opts.cursor.lastSeq++;
    callbacks.onStdout?.(transport.stdout);
    if (transport.replayTail !== '') {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      callbacks.onStdout?.(transport.replayTail);
    }
    if (transport.replayComplete) callbacks.onReplayComplete?.();
    if (transport.gapAfterStdout) {
      transport.checkpointAfterGap = transport.checkpointRecovery;
      throw new transport.Gap('unresolved replay gap', transport.gapToSeq);
    }
    if (transport.stderr !== '') callbacks.onStderr?.(transport.stderr);
    if (transport.protocolFailure) {
      const { ExecStreamProtocolError } =
        await import('../node_only/sandbox/helpers/session_client');
      throw new ExecStreamProtocolError('Replay history is unavailable');
    }
    if (transport.exitAfterStdout)
      return { exitCode: transport.exitCode, errorCode: transport.errorCode };
    // A live exec: the drain only ends when the window (or the cut) aborts,
    // or when the process exits on a stdin EOF.
    try {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
        transport.exitOnEof = resolve;
      });
    } finally {
      transport.exitOnEof = undefined;
    }
    return { exitCode: 0 };
  },
}));

const {
  drainHarnessWindow,
  classifyHarnessEnd,
  harnessOutputTail,
  isSpendRefusal,
  removeStagedInstructions,
  removeStagedSubscription,
  spendRefusalReason,
} = await import('./external_turn_shared');
const { SessionNotFoundError } =
  await import('../node_only/sandbox/helpers/session_client');

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
    transport.replayComplete = true;
    transport.stdout = '';
    transport.stderr = '';
    transport.replayTail = '';
    transport.cancelled = [];
    transport.exitAfterStdout = false;
    transport.checkpoint = null;
    transport.gapCheckpoint = null;
    transport.gapAfterStdout = false;
    transport.checkpointAfterGap = 'none';
    transport.recoveryCheckpoint = null;
    transport.gapToSeq = 5;
    transport.stdoutDelayMs = 0;
    transport.resumedAt = [];
    transport.exitCode = 0;
    transport.errorCode = undefined;
    transport.protocolFailure = false;
    transport.stdinWrites = [];
    transport.onEof = 'exit';
    transport.exitOnEof = undefined;
    transport.sessionOps = [];
    transport.deleteFailure = undefined;
    transport.deleteSkips = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it("ends a window early on its caller's signal, leaving the exec running for the next window", async () => {
    transport.stdout = PI_MID_TOOL;
    const stop = new AbortController();
    const started = Date.now();
    setTimeout(() => stop.abort(), 20);

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'stopping-server',
      harness: 'pi',
      windowMs: 60_000,
      signal: stop.signal,
    });

    expect(result.kind).toBe('running');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(transport.cancelled).toEqual([]);
  });

  it('keeps the background ledger when a later window no longer replays its start', async () => {
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      CLAUDE_RESULT,
    ]);
    const args = {
      sessionId: 'sandbox',
      execId: 'checkpoint-bg',
      harness: 'claude-code',
      windowMs: 10,
    };
    expect((await drainHarnessWindow(args)).kind).toBe('running');
    expect(transport.checkpoint?.seq).toBe(1);
    transport.stdout = ndjson([CLAUDE_RESULT]);
    expect((await drainHarnessWindow(args)).kind).toBe('running');
    expect(transport.cancelled).toEqual([]);
    expect(transport.resumedAt).toEqual([0, 1]);
    transport.stdout = ndjson([CLAUDE_TASK_SETTLED]);
    const terminal = await drainHarnessWindow({ ...args, windowMs: 2000 });
    expect(terminal.kind).toBe('terminal');
    // Stdin closes only once the restored ledger settles; the CLI exits.
    expect(transport.stdinWrites).toEqual([
      { execId: 'checkpoint-bg', eof: true },
    ]);
    expect(transport.cancelled).toEqual([]);
  });

  it.each(['missing', 'failed'] as const)(
    'does not turn an unresolved replay gap into success when checkpoint recovery %s crosses the end grace',
    async (recovery) => {
      transport.stdout = ndjson([CLAUDE_INIT, CLAUDE_RESULT]);
      transport.gapAfterStdout = true;
      transport.checkpointRecovery = recovery;
      await expect(
        drainHarnessWindow({
          sessionId: 'sandbox',
          execId: 'gap-grace',
          harness: 'claude-code',
          windowMs: 5000,
        }),
      ).rejects.toBeInstanceOf(transport.Gap);
      expect(transport.cancelled).toEqual([]);
    },
  );

  it('rejects a newer checkpoint that does not cover the whole missing range even after end grace', async () => {
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      CLAUDE_RESULT,
    ]);
    const args = {
      sessionId: 'sandbox',
      execId: 'incomplete-checkpoint',
      harness: 'claude-code',
      windowMs: 10,
    };
    expect((await drainHarnessWindow(args)).kind).toBe('running');
    if (transport.checkpoint === null) throw new Error('checkpoint missing');
    transport.recoveryCheckpoint = {
      seq: 20,
      state: {
        ...(transport.checkpoint.state as Record<string, unknown>),
        pendingTasks: [],
      },
    };
    transport.stdout = ndjson([CLAUDE_TASK_SETTLED]);
    transport.gapAfterStdout = true;
    transport.gapToSeq = 100;
    transport.checkpointRecovery = 'newer';
    await expect(
      drainHarnessWindow({ ...args, windowMs: 5000 }),
    ).rejects.toBeInstanceOf(transport.Gap);
    expect(transport.cancelled).toEqual([]);
    expect(transport.resumedAt).toEqual([0, 1]);
  });

  it('surfaces parser rejection even when the window deadline has already elapsed', async () => {
    transport.stdout = 'x'.repeat(8 * 1024 * 1024 + 1);
    transport.stdoutDelayMs = 20;
    await expect(
      drainHarnessWindow({
        sessionId: 'sandbox',
        execId: 'oversized',
        harness: 'claude-code',
        windowMs: 10,
      }),
    ).rejects.toThrow('Harness JSONL record exceeded 8 MiB');
    expect(transport.checkpoint).toBeNull();
    expect(transport.cancelled).toEqual([]);
  });

  it('adopts a newer atomic checkpoint when another reader prunes before attach', async () => {
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      CLAUDE_RESULT,
    ]);
    const args = {
      sessionId: 'sandbox',
      execId: 'checkpoint-race',
      harness: 'claude-code',
      windowMs: 10,
    };
    expect((await drainHarnessWindow(args)).kind).toBe('running');
    if (transport.checkpoint === null) throw new Error('checkpoint missing');
    transport.gapCheckpoint = { ...transport.checkpoint, seq: 5 };
    transport.stdout = ndjson([CLAUDE_RESULT]);
    expect((await drainHarnessWindow(args)).kind).toBe('running');
    expect(transport.resumedAt).toEqual([0, 1, 5]);
    expect(transport.cancelled).toEqual([]);
    expect(transport.checkpoint.seq).toBe(6);
  });

  it.each([true, false])(
    'keeps long final answers intact and refuses only an unavailable exact fallback (final report: %s)',
    async (hasFinalReport) => {
      const finalText = JSON.stringify({
        report: 'x'.repeat(70_000),
        done: true,
      });
      transport.stdout = ndjson([
        CLAUDE_INIT,
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: finalText }] },
        },
        { ...CLAUDE_RESULT, result: hasFinalReport ? finalText : '' },
      ]);
      transport.exitAfterStdout = true;
      const result = await drainHarnessWindow({
        sessionId: 'sandbox',
        execId: 'long-answer',
        harness: 'claude-code',
      });
      expect(result.kind).toBe('terminal');
      if (result.kind !== 'terminal') throw new Error('expected terminal');
      expect(result.text.length).toBeLessThanOrEqual(65_536);
      expect(result.textTruncated).toBe(true);
      if (hasFinalReport) {
        expect(result.ended?.finalText).toBe(finalText);
        expect(JSON.parse(result.ended?.finalText ?? '').done).toBe(true);
        expect(classifyHarnessEnd(result).errored).toBe(false);
      } else {
        expect(result.answerText).toBe(finalText);
        expect(classifyHarnessEnd(result).errored).toBe(false);
        expect(
          classifyHarnessEnd({ ...result, answerText: undefined }),
        ).toMatchObject({
          errored: true,
          reason: expect.stringContaining('complete final answer'),
        });
      }
    },
  );

  it('restores an unfinished JSONL line and usage across a worker handoff', async () => {
    const stream = readFixture('pi', 'shell-turn');
    const split = stream.indexOf('tool_execution_start') + 7;
    transport.stdout = stream.slice(0, split);
    const args = {
      sessionId: 'sandbox',
      execId: 'checkpoint-pi',
      harness: 'pi',
      windowMs: 10,
    };
    expect((await drainHarnessWindow(args)).kind).toBe('running');
    transport.stdout = stream.slice(split);
    transport.exitAfterStdout = true;
    const result = await drainHarnessWindow(args);
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.ended?.usageTotals).toEqual({
        inputTokens: 57,
        outputTokens: 22,
      });
      expect(result.agentSessionId).toBe(
        '0197f3c5-3f22-77e7-886f-2760868904b9',
      );
    }
    expect(transport.resumedAt).toEqual([0, 1]);
  });

  it('returns the complete final report beyond the display text cap', async () => {
    const report = 'first-line\n' + 'x'.repeat(80_000) + '\nlast-line';
    transport.stdout = ndjson([
      CLAUDE_INIT,
      { ...CLAUDE_RESULT, result: report },
    ]);
    transport.exitAfterStdout = true;
    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'large-report',
      harness: 'claude-code',
    });
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.ended?.finalText).toBe(report);
      expect(classifyHarnessEnd(result).errored).toBe(false);
    }
  });

  it('keeps the exact streamed narrative as settlement fallback while progress stays bounded', async () => {
    const report = 'first-line\n' + 'x'.repeat(80_000) + '\nlast-line';
    transport.stdout = ndjson([
      CLAUDE_INIT,
      {
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: report } },
      },
      { type: 'result', subtype: 'success', session_id: 'claude-1' },
    ]);
    transport.exitAfterStdout = true;
    const onText = vi.fn();
    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'narrative-only',
      harness: 'claude-code',
      onText,
    });
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.answerText).toBe(report);
      expect(result.text.length).toBeLessThanOrEqual(32_000);
      expect(result.ended?.finalText).toBeUndefined();
      expect(classifyHarnessEnd(result).errored).toBe(false);
    }
    expect(onText).toHaveBeenCalledOnce();
    expect(onText.mock.calls[0]?.[0].length).toBeLessThanOrEqual(32_000);
  });

  it('does not finish on a historical terminal marker before replay catches up', async () => {
    transport.stdout = ndjson([CLAUDE_INIT, CLAUDE_RESULT]);
    transport.replayTail = ndjson([CLAUDE_TASK_STARTED]);
    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'replaying',
      harness: 'claude-code',
      windowMs: 1750,
    });
    expect(result.kind).toBe('running');
    expect(transport.cancelled).toEqual([]);
  });

  it('carries the harness’s stderr tail on a window that exited without a turn', async () => {
    // A CLI that refuses to start writes its reason to stderr and exits:
    // no event, no JSON — the tail is the only lead the crash leaves.
    transport.replayComplete = true;
    transport.stdout = '';
    transport.stderr =
      '\u001b[31mError finding codex home\u001b[0m: CODEX_HOME points to "/agent/.runtime/home/.codex", but that path does not exist\n';
    transport.exitAfterStdout = true;

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'codex-dead',
      harness: 'codex',
      windowMs: 50,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.stderrTail).toBe(
        'Error finding codex home: CODEX_HOME points to "/agent/.runtime/home/.codex", but that path does not exist',
      );
      expect(classifyHarnessEnd(result).reason).toContain(
        'Last output: Error finding codex home',
      );
    }
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

  it('reaps an exec after a fatal replay protocol failure without publishing its prefix', async () => {
    transport.stdout = ndjson([CLAUDE_INIT, CLAUDE_RESULT]);
    transport.replayComplete = false;
    transport.protocolFailure = true;
    const onText = vi.fn();
    const onTimeline = vi.fn();
    await expect(
      drainHarnessWindow({
        sessionId: 'sandbox',
        execId: 'invalid-replay',
        harness: 'claude-code',
        windowMs: 50,
        onText,
        onTimeline,
      }),
    ).rejects.toThrow('Replay history is unavailable');
    expect(transport.cancelled).toEqual(['invalid-replay']);
    expect(onText).not.toHaveBeenCalled();
    expect(onTimeline).not.toHaveBeenCalled();
  });

  it('reaps a corrupt replay after checkpoint restoration even when the window expires', async () => {
    const args = {
      sessionId: 'sandbox',
      execId: 'checkpoint-corrupt-replay',
      harness: 'claude-code',
      windowMs: 10,
    };
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      CLAUDE_RESULT,
    ]);
    expect((await drainHarnessWindow(args)).kind).toBe('running');
    expect(transport.checkpoint?.seq).toBe(1);
    transport.stdout = ndjson([CLAUDE_TASK_SETTLED]);
    transport.stdoutDelayMs = 20;
    transport.replayComplete = false;
    transport.protocolFailure = true;
    const onText = vi.fn();
    const onTimeline = vi.fn();
    await expect(
      drainHarnessWindow({ ...args, onText, onTimeline }),
    ).rejects.toThrow('Replay history is unavailable');
    expect(transport.resumedAt).toEqual([0, 1]);
    expect(transport.cancelled).toEqual([args.execId]);
    expect(onText).not.toHaveBeenCalled();
    expect(onTimeline).not.toHaveBeenCalled();
  });

  it.each(['OUTPUT_GAP', 'REPLAY_GAP', 'REPLAY_UNAVAILABLE', 'OUTPUT_LIMIT'])(
    'reaps an exec after %s prevents rebuilding its full ledger',
    async (errorCode) => {
      transport.stdout = `${readFixture('claude-code', 'issue-to-pr')}\n`;
      transport.replayComplete = false;
      transport.exitAfterStdout = true;
      transport.errorCode = errorCode;
      const result = await drainHarnessWindow({
        sessionId: 'sandbox',
        execId: 'truncated-claude',
        harness: 'claude-code',
        windowMs: 50,
      });
      expect(transport.cancelled).toEqual(['truncated-claude']);
      expect(result.kind).toBe('terminal');
      if (result.kind === 'terminal') {
        expect(result.ended).toBeUndefined();
        expect(result.text).toBe('');
        expect(result.answerText).toBe('');
        expect(result.timeline).toEqual([]);
        expect(result.outputTokens).toBeUndefined();
        expect(classifyHarnessEnd(result).errored).toBe(true);
      }
    },
  );

  it('reports a Pi process killed during a tool as interrupted', async () => {
    transport.stdout = PI_MID_TOOL;
    transport.exitAfterStdout = true;
    transport.exitCode = 137;

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'killed-pi',
      harness: 'pi',
      windowMs: 50,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.ended).toBeUndefined();
      expect(result.agentSessionId).toBe('pi-live-session');
      expect(result.timeline.map((part) => part.type)).toEqual(['tool-bash']);
      expect(classifyHarnessEnd(result)).toEqual({
        errored: true,
        reason:
          'The harness exited unexpectedly (exit code 137) without completing the turn.',
        emptyAnswer: false,
      });
    }
    expect(transport.cancelled).toEqual([]);
  });

  it.each([
    {
      stopReason: 'error',
      status: 'error',
      message: 'gateway refused the call',
    },
    {
      stopReason: 'aborted',
      status: 'cancelled',
      message: 'Request was aborted',
    },
  ])(
    'preserves a held Pi $status reason on real exit',
    async ({ stopReason, status, message }) => {
      transport.stdout = ndjson([
        { type: 'session', id: 'pi-live-session', version: 3 },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason,
            errorMessage: message,
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
        expect(result.ended?.status).toBe(status);
        expect(result.harnessError).toBe(message);
        expect(classifyHarnessEnd(result)).toEqual({
          errored: true,
          reason: message,
          emptyAnswer: false,
        });
      }
      // The process exited on its own — nothing to reap.
      expect(transport.cancelled).toEqual([]);
    },
  );

  it('restores a long exact fallback when the terminal window only contains an empty result', async () => {
    const report = `BEGIN ${'report '.repeat(20_000)} END`;
    transport.stdout = ndjson([
      CLAUDE_INIT,
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: report }] },
      },
    ]);
    const args = {
      sessionId: 's',
      execId: 'fallback-checkpoint',
      harness: 'claude-code',
      windowMs: 30,
    };
    expect((await drainHarnessWindow(args)).kind).toBe('running');
    expect(transport.checkpoint?.seq).toBe(1);
    transport.stdout = ndjson([{ ...CLAUDE_RESULT, result: '' }]);
    transport.exitAfterStdout = true;
    const result = await drainHarnessWindow(args);
    expect(result.kind).toBe('terminal');
    if (result.kind !== 'terminal') throw new Error('expected terminal');
    expect(transport.resumedAt).toEqual([0, 1]);
    expect(result.answerText).toBe(report);
    expect(result.textTruncated).toBe(true);
    expect(classifyHarnessEnd(result)).toEqual({
      errored: false,
      emptyAnswer: false,
    });
  });

  it('keeps the exact terminal fallback when a successful result omits its final text', async () => {
    const report = `BEGIN ${'report '.repeat(20_000)} END`;
    transport.stdout = ndjson([
      CLAUDE_INIT,
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: report }] },
      },
      { ...CLAUDE_RESULT, result: '' },
    ]);
    transport.exitAfterStdout = true;
    const result = await drainHarnessWindow({
      sessionId: 's',
      execId: 'e',
      harness: 'claude-code',
      windowMs: 50,
    });
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.ended?.finalText).toBeUndefined();
      expect(result.answerText).toBe(report);
      expect(result.text.length).toBeLessThanOrEqual(64 * 1024);
    }
  });

  it('keeps the authoritative final report intact beyond the display text budget', async () => {
    const report = `BEGIN ${'report '.repeat(20_000)} END`;
    transport.stdout = ndjson([
      CLAUDE_INIT,
      { ...CLAUDE_RESULT, result: report },
    ]);
    transport.exitAfterStdout = true;
    const result = await drainHarnessWindow({
      sessionId: 's',
      execId: 'e',
      harness: 'claude-code',
      windowMs: 50,
    });
    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal')
      expect(result.ended?.finalText).toBe(report);
    if (result.kind !== 'gone')
      expect(result.text.length).toBeLessThanOrEqual(64 * 1024);
  });

  it('does not finalize a historical result before replay has caught up', async () => {
    transport.stdout = ndjson([CLAUDE_INIT, CLAUDE_RESULT]);
    transport.replayComplete = false;
    const result = await drainHarnessWindow({
      sessionId: 's',
      execId: 'e',
      harness: 'claude-code',
      windowMs: 50,
    });
    expect(result.kind).toBe('running');
    expect(transport.cancelled).toEqual([]);
  });

  it('withholds historical progress until replay reaches its live boundary', async () => {
    transport.stdout = `${readFixture('claude-code', 'issue-to-pr')}\n`;
    transport.replayComplete = false;
    const onText = vi.fn();
    const onTimeline = vi.fn();
    await drainHarnessWindow({
      sessionId: 's',
      execId: 'e',
      harness: 'claude-code',
      windowMs: 20,
      onText,
      onTimeline,
    });
    expect(onText).not.toHaveBeenCalled();
    expect(onTimeline).not.toHaveBeenCalled();
    transport.replayComplete = true;
    transport.exitAfterStdout = true;
    await drainHarnessWindow({
      sessionId: 's',
      execId: 'e',
      harness: 'claude-code',
      windowMs: 20,
      onText,
      onTimeline,
    });
    expect(onTimeline).toHaveBeenCalledTimes(1);
  });

  it.each(['opencode', 'pi'] as const)(
    'reconstructs every %s call usage after replay exceeds the old ring',
    async (harness) => {
      const calls = Array.from({ length: 300 }, (_, i) =>
        harness === 'opencode'
          ? {
              type: 'step_finish',
              sessionID: 'long-session',
              part: {
                reason: i === 299 ? 'stop' : 'tool-calls',
                cost: 0.01,
                tokens: { input: 10, output: 3 },
              },
              diagnostic: 'x'.repeat(1024),
            }
          : {
              type: 'message_end',
              message: {
                role: 'assistant',
                stopReason: i === 299 ? 'stop' : 'toolUse',
                content: [{ type: 'text', text: 'working' }],
                usage: { input: 10, output: 3 },
              },
              diagnostic: 'x'.repeat(1024),
            },
      );
      transport.stdout = ndjson(
        harness === 'pi' ? [...calls, { type: 'agent_end' }] : calls,
      );
      expect(transport.stdout.length).toBeGreaterThan(256 * 1024);
      transport.exitAfterStdout = true;
      const result = await drainHarnessWindow({
        sessionId: 's',
        execId: 'e',
        harness,
        windowMs: 50,
      });
      expect(result.kind).toBe('terminal');
      if (result.kind === 'terminal') {
        expect(result.outputTokens).toBe(900);
        expect(result.ended?.usageTotals).toMatchObject({
          inputTokens: 3000,
          outputTokens: 900,
        });
      }
    },
  );

  it('rebuilds an unfinished background ledger across more than the old ring budget', async () => {
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      ...Array.from({ length: 400 }, () => ({
        type: 'diagnostic',
        text: 'x'.repeat(1024),
      })),
      CLAUDE_RESULT,
    ]);
    expect(transport.stdout.length).toBeGreaterThan(256 * 1024);
    const result = await drainHarnessWindow({
      sessionId: 's',
      execId: 'e',
      harness: 'claude-code',
      windowMs: 50,
    });
    expect(result.kind).toBe('running');
    expect(transport.cancelled).toEqual([]);
    expect(result).toMatchObject({ agentSessionId: 'claude-1' });
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

  it('preserves Claude background control through real disk replay after the RAM ring overflowed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'claude-replay-'));
    const replay = new ExecReplay(undefined, new ReplayBudget(), directory);
    let seq = 0;
    const replayIntoTransport = async (since = 0) => {
      await replay.replay(
        since,
        seq,
        async (line) => {
          const event = JSON.parse(line) as { t: string; b64: string };
          if (event.t === 'stdout')
            transport.stdout += Buffer.from(event.b64, 'base64').toString(
              'utf8',
            );
        },
        () => {
          throw new Error('Unexpected replay gap');
        },
      );
    };
    try {
      const filler = {
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'x'.repeat(8192) } },
      };
      const bytes = Buffer.from(
        ndjson([
          CLAUDE_INIT,
          CLAUDE_TASK_STARTED,
          ...Array.from({ length: 128 }, () => filler),
          CLAUDE_RESULT,
        ]),
      );
      expect(bytes.byteLength).toBeGreaterThan(1024 * 1024);
      for (let offset = 0; offset < bytes.byteLength; offset += 16 * 1024) {
        await replay.append(
          `${JSON.stringify({
            t: 'stdout',
            seq: ++seq,
            b64: bytes.subarray(offset, offset + 16 * 1024).toString('base64'),
          })}\n`,
          seq,
        );
      }
      await replayIntoTransport();
      const running = await drainHarnessWindow({
        sessionId: 'sandbox',
        execId: 'replay-background',
        harness: 'claude-code',
        windowMs: 1750,
      });
      expect(running.kind).toBe('running');
      expect(transport.cancelled).toEqual([]);

      // This exact answer exceeds the checkpoint cap. The full spool must
      // remain available until a later replay reconstructs the settled ledger.
      expect(transport.checkpoint).toBeNull();
      await replay.append(
        `${JSON.stringify({
          t: 'stdout',
          seq: ++seq,
          b64: Buffer.from(ndjson([CLAUDE_TASK_SETTLED])).toString('base64'),
        })}\n`,
        seq,
      );
      transport.stdout = '';
      await replayIntoTransport();
      const terminal = await drainHarnessWindow({
        sessionId: 'sandbox',
        execId: 'replay-background',
        harness: 'claude-code',
        windowMs: 10000,
      });
      expect(terminal.kind).toBe('terminal');
      expect(transport.stdinWrites).toEqual([
        { execId: 'replay-background', eof: true },
      ]);
      expect(transport.cancelled).toEqual([]);
    } finally {
      await replay.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ends a claude turn once its background task settles', async () => {
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      CLAUDE_RESULT,
      CLAUDE_TASK_SETTLED,
    ]);
    transport.onEof = 'ignore';

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
    // Stdin closes only once the ledger is empty, and the lingering
    // hold-stdin process is reaped exactly once.
    expect(transport.stdinWrites).toEqual([{ execId: 'bg-claude', eof: true }]);
    expect(transport.cancelled).toEqual(['bg-claude']);
  });

  it('closes the stdin of a plain hold-stdin turn and ends on its own exit, without the grace or a reap', async () => {
    transport.stdout = ndjson([CLAUDE_INIT, CLAUDE_RESULT]);
    const started = Date.now();

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'plain-claude',
      harness: 'claude-code',
      windowMs: 10_000,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.exited).toBe(true);
      expect(result.execResult?.exitCode).toBe(0);
      expect(result.ended?.finalText).toBe(
        'The report is being generated in the background.',
      );
      expect(classifyHarnessEnd(result).errored).toBe(false);
    }
    expect(transport.stdinWrites).toEqual([
      { execId: 'plain-claude', eof: true },
    ]);
    expect(transport.cancelled).toEqual([]);
    // Well inside the 1.5 s grace the turn used to sit out on every reply.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it.each(['ignore', 'fail'] as const)(
    'cuts and reaps a hold-stdin turn after the grace when its stdin EOF is %sed',
    async (onEof) => {
      transport.stdout = ndjson([CLAUDE_INIT, CLAUDE_RESULT]);
      transport.onEof = onEof;

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
      expect(transport.stdinWrites).toEqual([
        { execId: 'plain-claude', eof: true },
      ]);
      expect(transport.cancelled).toEqual(['plain-claude']);
    },
  );

  it('never closes stdin while a background task is open, nor on a close-stdin harness', async () => {
    transport.stdout = ndjson([
      CLAUDE_INIT,
      CLAUDE_TASK_STARTED,
      CLAUDE_RESULT,
    ]);
    const lingering = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'bg-claude',
      harness: 'claude-code',
      windowMs: 50,
    });
    expect(lingering.kind).toBe('running');

    // Another exec: the stand-in keeps one checkpoint for all of them.
    transport.checkpoint = null;
    transport.stdout = readFixture('pi', 'shell-turn');
    transport.exitAfterStdout = true;
    const closed = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'pi-turn',
      harness: 'pi',
    });
    expect(closed.kind).toBe('terminal');

    expect(transport.stdinWrites).toEqual([]);
  });
});

/** Where the Gemini harness stages a member's Google sign-in. */
const GEMINI_CREDENTIAL = '.runtime/home/.gemini/oauth_creds.json';

describe('a staged subscription credential', () => {
  beforeEach(() => {
    transport.replayComplete = true;
    transport.stdout = '';
    transport.cancelled = [];
    transport.exitAfterStdout = true;
    transport.checkpoint = null;
    transport.sessionOps = [];
    transport.deleteFailure = undefined;
    transport.deleteSkips = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const geminiStart = (
    stagedFiles: Array<{ path: string; content: string }>,
  ): HarnessExec => ({
    argv: ['gemini'],
    env: {},
    cwd: '/agent/workspace',
    stagedFiles,
  });

  it('is removed before a Gemini turn that runs without it can start', async () => {
    await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'gemini-managed',
      harness: 'gemini',
      start: geminiStart([
        { path: '.runtime/home/.gemini/settings.json', content: '{}' },
      ]),
    });
    expect(transport.sessionOps).toEqual([
      `delete:${GEMINI_CREDENTIAL}`,
      'stage:.runtime/home/.gemini/settings.json',
      'launch',
    ]);
  });

  it('stays for the Gemini turn that stages it', async () => {
    await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'gemini-subscription',
      harness: 'gemini',
      start: geminiStart([
        { path: GEMINI_CREDENTIAL, content: '{"refresh_token":"member"}' },
      ]),
    });
    expect(transport.sessionOps).toEqual([
      `stage:${GEMINI_CREDENTIAL}`,
      'launch',
    ]);
  });

  it('is never looked for on a harness that takes its subscription through the environment', async () => {
    transport.stdout = readFixture('pi', 'shell-turn');
    await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'claude-turn',
      harness: 'claude-code',
      start: { argv: ['claude'], env: {}, cwd: '/agent/workspace' },
    });
    await removeStagedSubscription('sandbox', 'codex');
    expect(transport.sessionOps).toEqual(['launch']);
  });

  it('is removed at a settle, and a failed removal is logged, never thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear();
    await removeStagedSubscription('sandbox', 'gemini');
    expect(transport.sessionOps).toEqual([`delete:${GEMINI_CREDENTIAL}`]);

    transport.deleteSkips = [{ path: GEMINI_CREDENTIAL, reason: 'EACCES' }];
    await removeStagedSubscription('sandbox', 'gemini');
    transport.deleteSkips = [];
    transport.deleteFailure = new Error('spawner unreachable');
    await removeStagedSubscription('sandbox', 'gemini');
    expect(warn).toHaveBeenCalledTimes(2);

    // A session that is gone took the credential with it: nothing to log.
    transport.deleteFailure = new SessionNotFoundError('sandbox');
    await removeStagedSubscription('sandbox', 'gemini');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('an exec’s staged instructions', () => {
  beforeEach(() => {
    transport.sessionOps = [];
    transport.deleteFailure = undefined;
    transport.deleteSkips = [];
  });

  it('leave an OpenCode session under the exec’s own name', async () => {
    await removeStagedInstructions('pa-scribe', 'opencode', 'exec-7');
    expect(transport.sessionOps).toEqual([
      'delete:.runtime/tale/instructions/exec-7.md',
    ]);
  });

  it('are never looked for on a harness that passes its instructions another way', async () => {
    await removeStagedInstructions('pa-scribe', 'claude-code', 'exec-7');
    await removeStagedInstructions('pa-scribe', 'codex', 'exec-7');
    await removeStagedInstructions('pa-scribe', 'not-a-harness', 'exec-7');
    expect(transport.sessionOps).toEqual([]);
  });

  it('log a failed removal and never throw it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear();
    transport.deleteSkips = [
      { path: '.runtime/tale/instructions/exec-7.md', reason: 'EACCES' },
    ];
    await removeStagedInstructions('pa-scribe', 'opencode', 'exec-7');
    transport.deleteSkips = [];
    transport.deleteFailure = new Error('spawner unreachable');
    await removeStagedInstructions('pa-scribe', 'opencode', 'exec-7');
    expect(warn).toHaveBeenCalledTimes(2);

    // A session that is gone took the file with it: nothing to log.
    transport.deleteFailure = new SessionNotFoundError('pa-scribe');
    await removeStagedInstructions('pa-scribe', 'opencode', 'exec-7');
    expect(warn).toHaveBeenCalledTimes(2);
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

describe('harnessOutputTail', () => {
  it('strips terminal escapes and control characters, folds whitespace, keeps the tail', () => {
    expect(
      harnessOutputTail(
        '\u001b[31mError:\u001b[0m\tconfig\r\n  refused\u0007\n',
      ),
    ).toBe('Error: config refused');
    const long = `${'x'.repeat(700)} the end`;
    const tail = harnessOutputTail(long);
    expect(tail.startsWith('…')).toBe(true);
    expect(tail.endsWith(' the end')).toBe(true);
    expect(tail.length).toBe(601);
  });

  it('redacts anything shaped like a key a CLI might echo from its config', () => {
    expect(
      harnessOutputTail(
        'auth failed for Bearer sk-abcdefghijklmnop1234 with key-ZZZZZZZZZZZZ',
      ),
    ).toBe('auth failed for [redacted] with [redacted]');
  });
});

describe('classifyHarnessEnd', () => {
  beforeEach(() => {
    transport.replayComplete = true;
    transport.stdout = '';
    transport.cancelled = [];
    transport.exitAfterStdout = false;
    transport.exitCode = 0;
    transport.errorCode = undefined;
    transport.protocolFailure = false;
    transport.stdinWrites = [];
    transport.onEof = 'exit';
    transport.exitOnEof = undefined;
    transport.sessionOps = [];
    transport.deleteFailure = undefined;
    transport.deleteSkips = [];
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

  it('names the failure the harness reported as the reason (a Codex turn the provider refused)', async () => {
    // As captured 2026-09-26: Codex narrates, runs a tool, and the gateway's
    // second call draws DeepSeek's 400; the CLI hands the body back verbatim
    // on `turn.failed`. The reason is that sentence — never the narration.
    const refusal = JSON.stringify({
      is_bifrost_error: false,
      status_code: 400,
      error: {
        type: 'invalid_request_error',
        message:
          'The `reasoning_content` in the thinking mode must be passed back to the API.',
      },
    });
    transport.stdout = `${[
      { type: 'thread.started', thread_id: 'thr-1' },
      { type: 'turn.started' },
      {
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'agent_message',
          text: "I'll start by inspecting the workspace.",
        },
      },
      { type: 'error', message: refusal },
      { type: 'turn.failed', error: { message: refusal } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n')}\n`;
    transport.exitAfterStdout = true;
    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'exec-codex-refused',
      harness: 'codex',
      windowMs: 10_000,
    });
    if (result.kind !== 'terminal') {
      throw new Error(`expected a terminal window, got ${result.kind}`);
    }

    expect(result.text).toContain("I'll start by inspecting the workspace.");
    expect(result.ended).toMatchObject({ isError: true, apiErrorStatus: 400 });
    expect(classifyHarnessEnd(result)).toEqual({
      errored: true,
      reason:
        'The `reasoning_content` in the thinking mode must be passed back to the API. (API status 400)',
      emptyAnswer: false,
    });
  });

  it('fails a turn whose model answered nothing (the live empty 200)', async () => {
    // The held-stdin CLI lingers after its result until the window closes
    // its stdin; the turn then ends on the CLI's own exit, which is clean.
    const result = await drainCapture('empty-answer-turn', { exits: false });

    expect(result.exited).toBe(true);
    expect(result.execResult?.exitCode).toBe(0);
    expect(result.ended?.isError).toBe(false);
    expect(classifyHarnessEnd(result)).toEqual({
      errored: true,
      reason: EMPTY_ANSWER,
      emptyAnswer: true,
    });
    expect(transport.cancelled).toEqual([]);
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
    // usage — no text or tool call, but still real model output.
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
      expect(result.ended?.usageTotals).toEqual({
        inputTokens: 900,
        outputTokens: 12,
      });
      expect(result.outputTokens).toBe(12);
      expect(classifyHarnessEnd(result).errored).toBe(false);
    }
  });

  it('quotes the harness’s last stderr lines when it exited without ending the turn', () => {
    // A CLI that refuses to start says why on stderr and nowhere else;
    // the run used to read "exit code 1" with nothing to act on.
    expect(
      classifyHarnessEnd(
        cleanEnd({
          ended: undefined,
          exited: true,
          execResult: {
            status: 'completed',
            exitCode: 1,
            durationMs: 120,
            stdoutBase64: '',
            stderrBase64: '',
            truncated: { stdout: false, stderr: false },
          },
          stderrTail:
            'Error finding codex home: CODEX_HOME points to "/agent/.runtime/home/.codex", but that path does not exist',
        }),
      ),
    ).toEqual({
      errored: true,
      emptyAnswer: false,
      reason:
        'The harness exited unexpectedly (exit code 1) without completing the turn. Last output: Error finding codex home: CODEX_HOME points to "/agent/.runtime/home/.codex", but that path does not exist',
    });
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

describe('incomplete replay refusal', () => {
  it.each(['OUTPUT_GAP', 'REPLAY_GAP', 'REPLAY_UNAVAILABLE', 'OUTPUT_LIMIT'])(
    'never accepts an earlier successful result after %s',
    (errorCode) => {
      const result = classifyHarnessEnd({
        text: 'old output',
        timeline: [],
        exited: true,
        ended: {
          type: 'turn-ended',
          status: 'completed',
          finalText: 'old answer',
        },
        execResult: {
          status: 'failed',
          exitCode: null,
          durationMs: 0,
          stdoutBase64: '',
          stderrBase64: '',
          truncated: { stdout: false, stderr: false },
          errorCode,
          errorMessage: 'missing replay',
        },
      });
      expect(result.errored).toBe(true);
      expect(result.reason).toContain('replay');
    },
  );
});

describe('a window that cannot reach the spawner', () => {
  beforeEach(() => {
    transport.replayComplete = true;
    transport.stdout = '';
    transport.stderr = '';
    transport.replayTail = '';
    transport.cancelled = [];
    transport.exitAfterStdout = false;
    transport.checkpoint = null;
    transport.gapCheckpoint = null;
    transport.gapAfterStdout = false;
    transport.checkpointAfterGap = 'none';
    transport.stdoutDelayMs = 0;
    transport.resumedAt = [];
    transport.protocolFailure = false;
    transport.sessionOps = [];
    transport.checkpointFailure = undefined;
    transport.contactEvent = 'none';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const unreachable = () =>
    Object.assign(new Error('sandbox spawner unreachable'), {
      name: 'SpawnerUnreachableError',
    });

  it('ends running from the outage when the checkpoint read finds no spawner, leaving the exec alone', async () => {
    transport.checkpointFailure = unreachable();
    const before = Date.now();

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'checkpoint-refused',
      harness: 'pi',
      windowMs: 60_000,
    });

    expect(result.kind).toBe('running');
    if (result.kind !== 'running') return;
    expect(result.spawnerOutageSince).toBeGreaterThanOrEqual(before);
    expect(transport.resumedAt).toEqual([]);
    expect(transport.cancelled).toEqual([]);
  });

  it('keeps measuring an outage from the window that saw it begin', async () => {
    transport.checkpointFailure = unreachable();

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'still-away',
      harness: 'pi',
      windowMs: 60_000,
      spawnerOutageSince: 1_234,
    });

    expect(result).toMatchObject({
      kind: 'running',
      spawnerOutageSince: 1_234,
    });
  });

  it('still fails on a checkpoint read refused for another reason', async () => {
    transport.checkpointFailure = new Error(
      'Invalid SANDBOX_URL configuration',
    );

    await expect(
      drainHarnessWindow({
        sessionId: 'sandbox',
        execId: 'misconfigured',
        harness: 'pi',
        windowMs: 60_000,
      }),
    ).rejects.toThrow('Invalid SANDBOX_URL configuration');
  });

  it('ends running from the outage when its stream is lost until the window ends', async () => {
    transport.contactEvent = 'lost';
    const before = Date.now();

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'stream-lost',
      harness: 'pi',
      windowMs: 50,
    });

    expect(result.kind).toBe('running');
    if (result.kind !== 'running') return;
    expect(result.spawnerOutageSince).toBeGreaterThanOrEqual(before);
    expect(transport.cancelled).toEqual([]);
  });

  it('clears a carried outage once the stream flows again', async () => {
    transport.contactEvent = 'attached';

    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'back-again',
      harness: 'pi',
      windowMs: 50,
      spawnerOutageSince: 1_234,
    });

    expect(result.kind).toBe('running');
    expect(result).not.toHaveProperty('spawnerOutageSince');
  });

  it('reports no outage for a window that neither lost nor found the stream', async () => {
    const result = await drainHarnessWindow({
      sessionId: 'sandbox',
      execId: 'quiet',
      harness: 'pi',
      windowMs: 50,
    });

    expect(result.kind).toBe('running');
    expect(result).not.toHaveProperty('spawnerOutageSince');
  });
});
