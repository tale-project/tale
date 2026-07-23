// cursor-jsonl family tests. Parser expectations derive from the captured
// fixtures/cursor/issue-to-pr.yml stream (wrapper-keyed tool calls,
// camelCase usage on the result). Exec construction is covered by the golden
// fixtures + interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import { createParser } from './cursor-jsonl';

describe('cursor-jsonl parser', () => {
  it('normalizes the issue-to-pr stream (wrapper-keyed tools, result usage)', () => {
    const events = collectEvents(
      createParser('cursor'),
      readFixture('cursor', 'issue-to-pr'),
    );
    expect(events.map((e) => e.type)).toEqual([
      'turn-started',
      // The CLI echoes the prompt back as a `user` event — passed through
      // as raw, never rendered as agent output.
      'raw',
      'text',
      'tool-use',
      'tool-result',
      'text',
      'usage',
      'turn-ended',
    ]);
    expect(events[0]).toEqual({
      type: 'turn-started',
      harness: 'cursor',
      sessionId: 'cur_ses_abc',
    });
    // `shellToolCall` wrapper key → the Bash timeline name; args unwrap from
    // INSIDE the wrapper.
    expect(events[3]).toEqual({
      type: 'tool-use',
      toolUseId: 'call_1',
      toolName: 'Bash',
      input: {
        command: 'git checkout -b fix/issue-1',
        workingDirectory: '',
        timeout: 30000,
      },
    });
    expect(events[4]).toMatchObject({
      type: 'tool-result',
      toolUseId: 'call_1',
      output: {
        success: expect.objectContaining({
          exitCode: 0,
          stdout: 'Switched to a new branch\n',
        }),
        isBackground: false,
      },
    });
    // Cursor is byo-only — the result's camelCase usage block is the ONLY
    // accounting signal and must surface.
    expect(events[6]).toEqual({
      type: 'usage',
      inputTokens: 8107,
      outputTokens: 102,
      cacheReadTokens: 20160,
    });
    expect(events[7]).toEqual({
      type: 'turn-ended',
      status: 'completed',
      isError: false,
      sessionId: 'cur_ses_abc',
      finalText: 'Opening the PR.',
      usageTotals: { inputTokens: 8107, outputTokens: 102 },
    });
  });

  it('parses the issue-to-pr stream identically when fed in 7-byte chunks', () => {
    const text = readFixture('cursor', 'issue-to-pr');
    expect(collectEvents(createParser('cursor'), text, 7)).toEqual(
      collectEvents(createParser('cursor'), text),
    );
  });

  it('flags a shell failure buried in the nested result', () => {
    const line = {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'c9',
      tool_call: {
        shellToolCall: {
          args: { command: 'false' },
          result: { success: { exitCode: 2, stdout: '' } },
        },
      },
    };
    const events = collectEvents(
      createParser('cursor'),
      `${JSON.stringify(line)}\n`,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'tool-result',
      toolUseId: 'c9',
      isError: true,
    });
  });

  it('maps an errored result and surfaces error events', () => {
    const text = `${[
      { type: 'system', subtype: 'init', session_id: 'cur_2' },
      { type: 'error', message: 'invalid API key' },
      { type: 'result', subtype: 'error', is_error: true, result: 'crashed' },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    const events = collectEvents(createParser('cursor'), text);
    expect(events[1]).toMatchObject({
      type: 'error',
      message: 'invalid API key',
    });
    expect(events[2]).toEqual({
      type: 'turn-ended',
      status: 'error',
      isError: true,
      sessionId: 'cur_2',
      finalText: 'crashed',
    });
  });

  it('passes a tool_call without a call id and unknown events through as raw', () => {
    const noId = { type: 'tool_call', subtype: 'started', tool_call: {} };
    const unknown = { type: 'novel_event', z: 3 };
    const events = collectEvents(
      createParser('cursor'),
      `${[noId, unknown].map((l) => JSON.stringify(l)).join('\n')}\n`,
    );
    // First line also seeds the turn.
    expect(events).toEqual([
      { type: 'turn-started', harness: 'cursor' },
      { type: 'raw', harness: 'cursor', payload: noId },
      { type: 'raw', harness: 'cursor', payload: unknown },
    ]);
  });
});
