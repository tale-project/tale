// pi-jsonl family tests. Parser expectations derive from the captured
// fixtures/pi/shell-turn.yml stream (two agent cycles: a tool call, then
// the closing text, from a CLI before 1.0, which never settles) and the
// settled-*.yml streams the real Pi 1.6.0 wrote; the synthetic cases pin
// the auto-retry hold semantics the family documents. Exec construction is covered by the golden fixtures
// + interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import { createParser } from './pi-jsonl';

const SESSION = '0197f3c5-3f22-77e7-886f-2760868904b9';
const MODEL = 'openrouter/anthropic/claude-sonnet-4.6';

/** One NDJSON stream from event objects. */
function ndjson(lines: Array<Record<string, unknown>>): string {
  return `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
}

describe('pi-jsonl parser', () => {
  it('normalizes the shell-turn stream (per-cycle usage, summed totals)', () => {
    const events = collectEvents(
      createParser('pi'),
      readFixture('pi', 'shell-turn'),
    );
    expect(events).toEqual([
      { type: 'turn-started', harness: 'pi', sessionId: SESSION },
      // Cycle 1 ends in a toolUse stop: its assistant message_end carries
      // the cycle usage.
      { type: 'usage', inputTokens: 22, outputTokens: 9, model: MODEL },
      {
        type: 'tool-use',
        toolUseId: 'call_mock_1',
        toolName: 'bash',
        input: { command: 'echo hello' },
      },
      {
        type: 'tool-result',
        toolUseId: 'call_mock_1',
        isError: false,
        output: { content: [{ type: 'text', text: 'hello\n' }] },
      },
      { type: 'text-delta', text: 'Mock turn complete: ' },
      { type: 'text-delta', text: '2 + 2 = 4.' },
      { type: 'usage', inputTokens: 35, outputTokens: 13, model: MODEL },
      // A stream that never settles ends at its last clean agent_end;
      // totals sum BOTH cycles.
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: SESSION,
        finalText: 'Mock turn complete: 2 + 2 = 4.',
        usageTotals: { inputTokens: 57, outputTokens: 22 },
      },
    ]);
  });

  it('parses the shell-turn identically when fed in 7-byte chunks', () => {
    const text = readFixture('pi', 'shell-turn');
    expect(collectEvents(createParser('pi'), text, 7)).toEqual(
      collectEvents(createParser('pi'), text),
    );
  });

  it('holds an errored agent_end and finalizes it only at stream end', () => {
    const parser = createParser('pi');
    const mid = parser.feed(
      ndjson([
        { type: 'session', version: 3, id: 'pi-err' },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'gateway dead',
            usage: { input: 0, output: 0 },
          },
        },
        { type: 'agent_end', messages: [] },
      ]),
    );
    // Nothing terminal yet — a retry cycle may still follow.
    expect(mid).toEqual([
      { type: 'turn-started', harness: 'pi', sessionId: 'pi-err' },
    ]);
    expect(parser.end()).toEqual([
      { type: 'error', message: 'gateway dead' },
      {
        type: 'turn-ended',
        status: 'error',
        sessionId: 'pi-err',
        isError: true,
      },
    ]);
  });

  it('completes normally when an auto-retry cycle succeeds', () => {
    const events = collectEvents(
      createParser('pi'),
      ndjson([
        { type: 'session', version: 3, id: 'pi-retry' },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'first try failed',
            usage: { input: 0, output: 0 },
          },
        },
        { type: 'agent_end', messages: [] },
        { type: 'auto_retry_start', attempt: 1, maxAttempts: 3 },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'done after retry' }],
            stopReason: 'stop',
            usage: { input: 12, output: 4 },
          },
        },
        { type: 'agent_end', messages: [] },
        { type: 'auto_retry_end', success: true, attempt: 1 },
      ]),
    );
    expect(events).toEqual([
      { type: 'turn-started', harness: 'pi', sessionId: 'pi-retry' },
      { type: 'usage', inputTokens: 12, outputTokens: 4 },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'pi-retry',
        finalText: 'done after retry',
        usageTotals: { inputTokens: 12, outputTokens: 4 },
      },
    ]);
  });

  it("books every message's cache reads and writes in the turn's input", () => {
    // pi-ai's `input` is only the uncached remainder of each call.
    const events = collectEvents(
      createParser('pi'),
      ndjson([
        { type: 'session', version: 3, id: 'pi-cache' },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'toolUse',
            usage: { input: 30, output: 5, cacheRead: 0, cacheWrite: 900 },
          },
        },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'done' }],
            stopReason: 'stop',
            usage: { input: 40, output: 7, cacheRead: 900, cacheWrite: 60 },
          },
        },
        { type: 'agent_end', messages: [] },
      ]),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'turn-ended',
      status: 'completed',
      usageTotals: { inputTokens: 30 + 900 + 40 + 900 + 60, outputTokens: 12 },
    });
  });

  it('finalizes as an error when the retry loop reports failure', () => {
    const events = collectEvents(
      createParser('pi'),
      ndjson([
        { type: 'session', version: 3, id: 'pi-dead' },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'first failure',
            usage: { input: 0, output: 0 },
          },
        },
        { type: 'agent_end', messages: [] },
        { type: 'auto_retry_start', attempt: 1, maxAttempts: 2 },
        { type: 'auto_retry_end', success: false, finalError: 'still dead' },
      ]),
    );
    expect(events).toEqual([
      { type: 'turn-started', harness: 'pi', sessionId: 'pi-dead' },
      { type: 'error', message: 'still dead' },
      {
        type: 'turn-ended',
        status: 'error',
        sessionId: 'pi-dead',
        isError: true,
      },
    ]);
  });

  it('maps an aborted stop reason to the cancelled status', () => {
    const parser = createParser('pi');
    parser.feed(
      ndjson([
        { type: 'session', version: 3, id: 'pi-stop' },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'aborted',
            usage: { input: 0, output: 0 },
          },
        },
        { type: 'agent_end', messages: [] },
      ]),
    );
    expect(parser.end()).toEqual([
      {
        type: 'turn-ended',
        status: 'cancelled',
        sessionId: 'pi-stop',
        isError: true,
      },
    ]);
  });

  it.each(['toolUse', 'stop', 'length'])(
    'does not invent a successful turn at EOF after a %s message',
    (stopReason) => {
      const parser = createParser('pi');
      const events = parser.feed(
        ndjson([
          { type: 'session', version: 3, id: 'pi-interrupted' },
          {
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'I will check this now.' }],
              stopReason,
              usage: { input: 12, output: 4 },
            },
          },
          ...(stopReason === 'toolUse'
            ? [
                {
                  type: 'tool_execution_start',
                  toolCallId: 'call-interrupted',
                  toolName: 'bash',
                  args: { command: 'sleep 60' },
                },
              ]
            : []),
        ]),
      );
      if (stopReason === 'toolUse') {
        expect(events).toContainEqual({
          type: 'tool-use',
          toolUseId: 'call-interrupted',
          toolName: 'bash',
          input: { command: 'sleep 60' },
        });
      }
      // A process may die after a model message but before its tools or the
      // agent loop finish. Only agent_end confirms successful completion;
      // leaving no result lets the shared host classify the exit as a crash.
      expect(parser.end()).toEqual([]);
      expect(events.some((event) => event.type === 'turn-ended')).toBe(false);
    },
  );

  it('surfaces wrapper failures as an errored turn', () => {
    const events = collectEvents(
      createParser('pi'),
      ndjson([{ type: 'wrapper_error', message: 'staging failed' }]),
    );
    expect(events).toEqual([
      { type: 'turn-started', harness: 'pi' },
      {
        type: 'error',
        message: 'staging failed',
        raw: { type: 'wrapper_error', message: 'staging failed' },
      },
      { type: 'turn-ended', status: 'error', isError: true },
    ]);
  });

  it('ends a Pi 1.x turn where Pi settles, not at its first agent_end', () => {
    const parser = createParser('pi');
    // Fed whole without the stream's end: agent_settled ends the turn.
    const events = parser.feed(`${readFixture('pi', 'settled-shell-turn')}\n`);
    expect(events.at(-1)).toEqual({
      type: 'turn-ended',
      status: 'completed',
      sessionId: '01a204dc-cf02-70fc-bbd2-ca8e226e0b3f',
      finalText: 'Done.',
      usageTotals: { inputTokens: 240, outputTokens: 24 },
    });
    expect(events.filter((event) => event.type === 'tool-use')).toEqual([
      {
        type: 'tool-use',
        toolUseId: 'call_lab_1',
        toolName: 'bash',
        input: { command: 'echo hello' },
      },
    ]);
    expect(parser.end()).toEqual([]);
  });

  it('completes a Pi 1.x turn whose first model call was retried', () => {
    const events = createParser('pi').feed(
      `${readFixture('pi', 'settled-retry-turn')}\n`,
    );
    expect(events.filter((event) => event.type !== 'text-delta')).toEqual([
      {
        type: 'turn-started',
        harness: 'pi',
        sessionId: '01a204dc-d357-77b3-b9af-e3a0d55c1110',
      },
      { type: 'usage', inputTokens: 120, outputTokens: 12, model: 'lab-model' },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: '01a204dc-d357-77b3-b9af-e3a0d55c1110',
        finalText: 'Done.',
        usageTotals: { inputTokens: 120, outputTokens: 12 },
      },
    ]);
  });

  it('ends a Pi 1.x turn whose model call failed with the error, where it settles', () => {
    const events = createParser('pi').feed(
      `${readFixture('pi', 'settled-error-turn')}\n`,
    );
    expect(events.slice(-2)).toEqual([
      {
        type: 'error',
        message: '400: {"message":"lab upstream 400","type":"lab"}',
      },
      {
        type: 'turn-ended',
        status: 'error',
        sessionId: '01a204dc-df7d-7180-96bc-4145efd5de6d',
        isError: true,
      },
    ]);
  });

  it('keeps the turn open across a run that a steer continues', () => {
    const parser = createParser('pi');
    const assistant = (text: string) => ({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        stopReason: 'stop',
        usage: { input: 10, output: 2 },
      },
    });
    const first = parser.feed(
      ndjson([
        { type: 'session', version: 3, id: 'pi-steer' },
        { type: 'agent_start' },
        assistant('Working on it.'),
        { type: 'agent_end', messages: [] },
      ]),
    );
    expect(first.some((event) => event.type === 'turn-ended')).toBe(false);
    const second = parser.feed(
      ndjson([
        { type: 'agent_start' },
        assistant('Done, with the change you asked for.'),
        { type: 'agent_end', messages: [] },
        { type: 'agent_settled', aborted: false },
      ]),
    );
    expect(second.at(-1)).toEqual({
      type: 'turn-ended',
      status: 'completed',
      sessionId: 'pi-steer',
      finalText: 'Done, with the change you asked for.',
      usageTotals: { inputTokens: 20, outputTokens: 4 },
    });
  });

  it('ends a turn Pi settled as aborted as cancelled', () => {
    const events = createParser('pi').feed(
      ndjson([
        { type: 'session', version: 3, id: 'pi-aborted' },
        { type: 'agent_start' },
        { type: 'agent_end', messages: [] },
        { type: 'agent_settled', aborted: true },
      ]),
    );
    expect(events.at(-1)).toEqual({
      type: 'turn-ended',
      status: 'cancelled',
      sessionId: 'pi-aborted',
      isError: true,
    });
  });

  it('carries a clean run across a checkpoint, for a stream that never settles', () => {
    const before = createParser('pi');
    before.feed(
      ndjson([
        { type: 'session', version: 3, id: 'pi-ckpt' },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'All done.' }],
            stopReason: 'stop',
            usage: { input: 5, output: 1 },
          },
        },
        { type: 'agent_end', messages: [] },
      ]),
    );
    const after = createParser('pi');
    after.restore(before.snapshot());
    expect(after.end()).toEqual([
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'pi-ckpt',
        finalText: 'All done.',
        usageTotals: { inputTokens: 5, outputTokens: 1 },
      },
    ]);
  });

  it('consumes lifecycle noise silently and passes unknown events as raw', () => {
    const unknown = { type: 'novel_pi_event', w: 5 };
    const events = collectEvents(
      createParser('pi'),
      ndjson([
        { type: 'session', version: 3, id: 'pi-noise' },
        { type: 'agent_start' },
        { type: 'turn_start' },
        { type: 'message_start', message: { role: 'assistant' } },
        { type: 'tool_execution_update', toolCallId: 'c1' },
        { type: 'entry_appended', entry: { type: 'custom' } },
        unknown,
      ]),
    );
    expect(events).toEqual([
      { type: 'turn-started', harness: 'pi', sessionId: 'pi-noise' },
      { type: 'raw', harness: 'pi', payload: unknown },
    ]);
  });
});
