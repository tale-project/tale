// pi-jsonl family tests. Parser expectations derive from the captured
// fixtures/pi/shell-turn.yml stream (two agent cycles: a tool call, then
// the closing text); the synthetic cases pin the auto-retry hold semantics
// the family documents. Exec construction is covered by the golden fixtures
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
      // agent_end on a clean cycle is terminal; totals sum BOTH cycles.
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
        unknown,
      ]),
    );
    expect(events).toEqual([
      { type: 'turn-started', harness: 'pi', sessionId: 'pi-noise' },
      { type: 'raw', harness: 'pi', payload: unknown },
    ]);
  });
});
