// gemini-stream family tests. Parser expectations derive from the captured
// fixtures/gemini/shell-turn.yml stream; the family also serves qwen-code
// (a gemini-cli fork with the same stream shapes), pinned by the slug
// attribution case. Exec construction is covered by the golden fixtures +
// interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import { createParser } from './gemini-stream';

const SESSION = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('gemini-stream parser', () => {
  it('normalizes the shell-turn stream (deltas, tool pair, terminal stats)', () => {
    const events = collectEvents(
      createParser('gemini'),
      readFixture('gemini', 'shell-turn'),
    );
    expect(events).toEqual([
      {
        type: 'turn-started',
        harness: 'gemini',
        sessionId: SESSION,
        model: 'gemini-2.5-pro',
      },
      // The role:"user" message is the CLI echoing the prompt — dropped, not
      // agent output.
      {
        type: 'tool-use',
        toolUseId: 'run_shell_command__run_shell_command_1751900000000_0',
        toolName: 'run_shell_command',
        input: { command: 'echo hello' },
      },
      {
        type: 'tool-result',
        toolUseId: 'run_shell_command__run_shell_command_1751900000000_0',
        isError: false,
        output: 'hello',
      },
      { type: 'text-delta', text: 'Mock turn complete: ' },
      { type: 'text-delta', text: '2 + 2 = 4.' },
      { type: 'usage', inputTokens: 22, outputTokens: 13 },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: SESSION,
        finalText: 'Mock turn complete: 2 + 2 = 4.',
        durationMs: 68,
        usageTotals: { inputTokens: 22, outputTokens: 13 },
      },
    ]);
  });

  it('parses the shell-turn identically when fed in 7-byte chunks', () => {
    const text = readFixture('gemini', 'shell-turn');
    expect(collectEvents(createParser('gemini'), text, 7)).toEqual(
      collectEvents(createParser('gemini'), text),
    );
  });

  it('attributes events to the harness that ran (qwen-code shares the family)', () => {
    const events = collectEvents(
      createParser('qwen-code'),
      readFixture('gemini', 'shell-turn'),
    );
    expect(events[0]).toMatchObject({
      type: 'turn-started',
      harness: 'qwen-code',
    });
  });

  it('maps a failed tool result and a fatal error result', () => {
    const text = `${[
      { type: 'init', session_id: 'g-err', model: 'gemini-2.5-pro' },
      {
        type: 'tool_result',
        tool_id: 't1',
        status: 'error',
        error: { type: 'ToolError', message: 'command not found' },
      },
      {
        type: 'result',
        status: 'error',
        error: { message: 'quota exhausted' },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    const events = collectEvents(createParser('gemini'), text);
    expect(events[1]).toEqual({
      type: 'tool-result',
      toolUseId: 't1',
      isError: true,
      output: 'command not found',
    });
    expect(events[2]).toMatchObject({
      type: 'error',
      message: 'quota exhausted',
    });
    expect(events[3]).toMatchObject({
      type: 'turn-ended',
      status: 'error',
      isError: true,
    });
  });

  it('classifies the turn-cap error as max-turns', () => {
    const line = {
      type: 'result',
      status: 'error',
      error: { message: 'Reached max session turns for this session.' },
    };
    const events = collectEvents(
      createParser('gemini'),
      `${JSON.stringify(line)}\n`,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'turn-ended',
      status: 'max-turns',
      isError: true,
    });
  });

  it('surfaces standalone errors and passes unknown events through as raw', () => {
    const unknown = { type: 'novel_gemini_event', k: 1 };
    const text = `${[
      { type: 'error', severity: 'error', message: 'stream hiccup' },
      unknown,
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    const events = collectEvents(createParser('gemini'), text);
    expect(events[1]).toMatchObject({
      type: 'error',
      message: 'stream hiccup',
    });
    expect(events[2]).toEqual({
      type: 'raw',
      harness: 'gemini',
      payload: unknown,
    });
  });
});
