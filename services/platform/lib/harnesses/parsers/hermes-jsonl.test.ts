// hermes-jsonl family tests. Parser expectations derive from the captured
// fixtures/hermes/issue-to-pr.yml stream (the tale-hermes-run lifecycle
// dialect). Exec construction is covered by the golden fixtures +
// interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import { createParser } from './hermes-jsonl';

describe('hermes-jsonl parser', () => {
  it('normalizes the issue-to-pr stream (late session id reaches turn-ended)', () => {
    const events = collectEvents(
      createParser('hermes'),
      readFixture('hermes', 'issue-to-pr'),
    );
    expect(events).toEqual([
      // run_start carries session_id null — the id only arrives later via
      // the session_id event, so turn-started has none.
      {
        type: 'turn-started',
        harness: 'hermes',
        model: 'openrouter:anthropic/claude-sonnet-4.6',
      },
      { type: 'text-delta', text: 'Reading the issue.' },
      {
        type: 'tool-use',
        toolUseId: 'call_1',
        toolName: 'terminal',
        input: 'git status',
      },
      { type: 'tool-result', toolUseId: 'call_1', isError: false },
      {
        type: 'tool-use',
        toolUseId: 'call_2',
        toolName: 'read_file',
        input: '/agent/workspace/README.md',
      },
      { type: 'tool-result', toolUseId: 'call_2', isError: false },
      {
        type: 'tool-use',
        toolUseId: 'call_3',
        toolName: 'terminal',
        input: 'gh pr create --fill',
      },
      { type: 'tool-result', toolUseId: 'call_3', isError: false },
      { type: 'text', text: 'Opened PR #99 with the fix.' },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: '20260705_120006_hermes1',
        finalText: 'Opened PR #99 with the fix.',
      },
    ]);
  });

  it('parses the issue-to-pr stream identically when fed in 7-byte chunks', () => {
    const text = readFixture('hermes', 'issue-to-pr');
    expect(collectEvents(createParser('hermes'), text, 7)).toEqual(
      collectEvents(createParser('hermes'), text),
    );
  });

  it('maps an errored run_end to error + errored turn-ended', () => {
    const text = `${[
      { type: 'run_start', session_id: 'h-1' },
      { type: 'run_end', status: 'error', error: 'provider exploded' },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    const events = collectEvents(createParser('hermes'), text);
    expect(events[1]).toMatchObject({
      type: 'error',
      message: 'provider exploded',
    });
    expect(events[2]).toEqual({
      type: 'turn-ended',
      status: 'error',
      sessionId: 'h-1',
      isError: true,
    });
  });

  it('classifies a turn-cap error as max-turns, not any max_* mention', () => {
    const capped = collectEvents(
      createParser('hermes'),
      `${JSON.stringify({
        type: 'run_end',
        status: 'error',
        error: 'stopped: max turns exhausted',
      })}\n`,
    );
    expect(capped.at(-1)).toMatchObject({
      type: 'turn-ended',
      status: 'max-turns',
    });
    const modelError = collectEvents(
      createParser('hermes'),
      `${JSON.stringify({
        type: 'run_end',
        status: 'error',
        error: 'max_tokens exceeded for this model',
      })}\n`,
    );
    expect(modelError.at(-1)).toMatchObject({
      type: 'turn-ended',
      status: 'error',
    });
  });

  it('carries tool failure output and passes unknown events through as raw', () => {
    const unknown = { type: 'novel_hermes_event', n: 2 };
    const text = `${[
      {
        type: 'tool_call_end',
        call_id: 'c1',
        status: 'error',
        output: 'denied',
      },
      unknown,
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    const events = collectEvents(createParser('hermes'), text);
    expect(events[1]).toEqual({
      type: 'tool-result',
      toolUseId: 'c1',
      isError: true,
      output: 'denied',
    });
    expect(events[2]).toEqual({
      type: 'raw',
      harness: 'hermes',
      payload: unknown,
    });
  });
});
