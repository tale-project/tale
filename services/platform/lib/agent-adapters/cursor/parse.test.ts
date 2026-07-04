import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { CursorParser } from './parse';

const FIXTURE = join(
  import.meta.dirname,
  '../fixtures/cursor/issue-to-pr.jsonl',
);

function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new CursorParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

describe('CursorParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the full issue→PR stream to normalized events', () => {
    const events = parseChunked(text, 10_000);

    const started = events.filter((e) => e.type === 'run-started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      agent: 'cursor',
      agentSessionId: 'cur_ses_abc',
    });

    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => (e.type === 'text' ? e.text : '')),
    ).toEqual(['Implementing the fix.', 'Opening the PR.']);

    const toolUse = events.find((e) => e.type === 'tool-use');
    // The tool name is the nested wrapper KEY (shellToolCall → Bash), and the
    // args live INSIDE that wrapper — both must be extracted (a blank name or a
    // missing input makes the persisted tool-call part fail message validation).
    expect(toolUse).toMatchObject({
      toolName: 'Bash',
      toolUseId: 'call_1',
      input: { command: 'git checkout -b fix/issue-1' },
    });
    const results = events.filter((e) => e.type === 'tool-result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ toolUseId: 'call_1' });
    // A zero-exit shell result is not an error.
    expect(
      results[0]?.type === 'tool-result' && results[0].isError,
    ).toBeFalsy();

    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({
      status: 'completed',
      agentSessionId: 'cur_ses_abc',
      finalText: 'Opening the PR.',
    });
  });

  it('survives arbitrary chunk splits', () => {
    const whole = parseChunked(text, 10_000);
    for (const size of [1, 3, 7, 13, 37, 128]) {
      expect(parseChunked(text, size)).toEqual(whole);
    }
  });

  it('REGRESSION GUARD: nested tool_call wrapper yields a real name + input, never blank/undefined', () => {
    // Shape captured live from the CLI 2026.03.20: the tool NAME is the wrapper
    // KEY and args are nested. The old parser looked for tool_call.tool/.input
    // (absent here) and emitted toolName:'' + input:undefined — which serialized
    // to a tool-call part missing both `input` and `args`, failing the assistant
    // message validator and killing the whole (otherwise successful) turn.
    const parser = new CursorParser();
    const events = [
      ...parser.feed(
        `${JSON.stringify({
          type: 'tool_call',
          subtype: 'started',
          call_id: 'tool_abc',
          tool_call: {
            shellToolCall: {
              args: { command: 'echo hi', workingDirectory: '' },
            },
          },
        })}\n`,
      ),
      ...parser.end(),
    ];
    const use = events.find((e) => e.type === 'tool-use');
    expect(use?.type).toBe('tool-use');
    if (use?.type === 'tool-use') {
      expect(use.toolName).toBe('Bash');
      expect(use.toolName).not.toBe('');
      expect(use.input).toEqual({ command: 'echo hi', workingDirectory: '' });
      expect(use.input).not.toBeUndefined();
    }
  });

  it('flags a non-zero shell exit as an errored tool result', () => {
    const parser = new CursorParser();
    const events = [
      ...parser.feed(
        `${JSON.stringify({
          type: 'tool_call',
          subtype: 'completed',
          call_id: 'tool_err',
          tool_call: {
            shellToolCall: {
              result: { success: { exitCode: 1, stderr: 'boom' } },
            },
          },
        })}\n`,
      ),
      ...parser.end(),
    ];
    const res = events.find((e) => e.type === 'tool-result');
    expect(res?.type === 'tool-result' && res.isError).toBe(true);
  });
});
