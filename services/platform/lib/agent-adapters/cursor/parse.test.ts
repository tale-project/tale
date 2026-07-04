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
    expect(toolUse).toMatchObject({ toolName: 'Bash', toolUseId: 'call_1' });
    const results = events.filter((e) => e.type === 'tool-result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ toolUseId: 'call_1' });

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
});
