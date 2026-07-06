import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { HermesParser } from './parse';

const FIXTURE = join(
  import.meta.dirname,
  '../fixtures/hermes/issue-to-pr.jsonl',
);

function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new HermesParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

describe('HermesParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the full issue→PR stream to normalized events', () => {
    const events = parseChunked(text, 10_000);

    const started = events.find((e) => e.type === 'run-started');
    expect(started).toMatchObject({
      type: 'run-started',
      agent: 'hermes',
      model: 'openrouter:anthropic/claude-sonnet-4.6',
    });

    const deltas = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => (e.type === 'text-delta' ? e.text : ''));
    expect(deltas.join('')).toBe('Reading the issue.');

    const toolUses = events.filter((e) => e.type === 'tool-use');
    expect(
      toolUses.map((e) => (e.type === 'tool-use' ? e.toolName : '')),
    ).toEqual(['terminal', 'read_file', 'terminal']);

    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      status: 'completed',
      agentSessionId: '20260705_120006_hermes1',
      finalText: 'Opened PR #99 with the fix.',
    });
  });

  it('parses the fixture with pathological mid-line chunk splits', () => {
    for (const chunkSize of [1, 7, 13, 37, 256]) {
      const events = parseChunked(text, chunkSize);
      expect(events.some((e) => e.type === 'run-started')).toBe(true);
      expect(events.some((e) => e.type === 'result')).toBe(true);
      const toolUses = events.filter((e) => e.type === 'tool-use');
      expect(toolUses.length).toBe(3);
    }
  });

  it('emits no usage events (tale-hermes-run carries no token counts)', () => {
    const events = parseChunked(text, 10_000);
    expect(events.filter((e) => e.type === 'usage')).toEqual([]);
  });

  it("maps a turn-cap error to max-turns but not every error mentioning 'max'", () => {
    const runEnd = (error: string) =>
      new HermesParser().feed(
        JSON.stringify({ type: 'run_end', status: 'error', error }) + '\n',
      );

    const capped = runEnd('Reached max iterations (90)').find(
      (e) => e.type === 'result',
    );
    expect(capped).toMatchObject({ type: 'result', status: 'max-turns' });

    const modelError = runEnd('max_tokens exceeded for this request').find(
      (e) => e.type === 'result',
    );
    expect(modelError).toMatchObject({ type: 'result', status: 'error' });
  });
});
