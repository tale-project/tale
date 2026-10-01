// gemini-stream family tests. Parser expectations derive from the captured
// fixtures/gemini/shell-turn.yml stream; the family also serves qwen-code
// (a gemini-cli fork with the same stream shapes), pinned by the slug
// attribution case. Exec construction is covered by the golden fixtures +
// interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import { createParser, describeTurnFailure } from './gemini-stream';

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

  it('reads the provider status and sentence out of a relayed 400 body', () => {
    const events = collectEvents(
      createParser('gemini'),
      readFixture('gemini', 'api-error-400'),
    );
    // The run's reason is the provider's sentence with the status, never
    // the gateway's JSON dump; the status lets the kick start fresh.
    expect(events.at(-2)).toMatchObject({
      type: 'error',
      message: 'forced upstream failure 400 (API status 400)',
    });
    expect(events.at(-1)).toEqual({
      type: 'turn-ended',
      status: 'error',
      sessionId: '0a2ef4a3-5fa0-4a11-9f8c-2e6f6a5a1b11',
      durationMs: 0,
      isError: true,
      apiErrorStatus: 400,
    });
  });

  it('recognises a 429 by the rate-limit sentence the CLI adds', () => {
    const events = collectEvents(
      createParser('gemini'),
      readFixture('gemini', 'api-error-429'),
    );
    // No body survives the SDK's retries, so the message passes through
    // whole; the prose is the tell.
    expect(events.at(-2)).toMatchObject({
      type: 'error',
      message: expect.stringContaining(
        '[API Error: forced upstream failure 429]',
      ),
    });
    expect(events.at(-1)).toMatchObject({
      type: 'turn-ended',
      status: 'error',
      isError: true,
      apiErrorStatus: 429,
    });
  });

  it('leaves a message without a body or a tell unstamped', () => {
    for (const message of [
      '[API Error: An unknown error occurred.]',
      'Reached max session turns for this session.',
      '[API Error: not json {oops]',
    ]) {
      const line = { type: 'result', status: 'error', error: { message } };
      const ended = collectEvents(
        createParser('gemini'),
        `${JSON.stringify(line)}\n`,
      ).at(-1);
      expect(ended).not.toHaveProperty('apiErrorStatus');
    }
    expect(
      describeTurnFailure('[API Error: An unknown error occurred.]'),
    ).toEqual({ message: '[API Error: An unknown error occurred.]' });
    // A 5xx body carries its code the same way a 4xx does.
    expect(
      describeTurnFailure(
        '[API Error: {"error":{"code":500,"message":"forced upstream failure 500","status":"invalid_request_error","details":null}}]',
      ),
    ).toEqual({
      message: 'forced upstream failure 500 (API status 500)',
      apiErrorStatus: 500,
    });
    // A body without an HTTP code: the sentence is kept, nothing stamped.
    expect(
      describeTurnFailure('[API Error: {"error":{"message":"odd"}}]'),
    ).toEqual({ message: 'odd' });
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
