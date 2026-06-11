import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { ClaudeCodeParser } from './parse';

const FIXTURE = join(
  import.meta.dirname,
  '../../fixtures/claude_code/issue-to-pr.jsonl',
);

/** Feed a fixture through the parser in arbitrary byte-sized chunks so the
 * test exercises mid-line splits (the JSONL reassembler's whole job). */
function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new ClaudeCodeParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

describe('ClaudeCodeParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the full issue→PR stream to normalized events', () => {
    const events = parseChunked(text, 10_000);

    const started = events.find((e) => e.type === 'run-started');
    expect(started).toMatchObject({
      type: 'run-started',
      agent: 'claude-code',
      agentSessionId: 'sess-abc',
      model: 'claude-sonnet-4-6',
    });

    // text-delta reassembled across two delta events.
    const deltas = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => (e.type === 'text-delta' ? e.text : ''));
    expect(deltas.join('')).toBe('Reading the issue.');

    // tool-use / tool-result.
    const toolUses = events.filter((e) => e.type === 'tool-use');
    expect(
      toolUses.map((e) => (e.type === 'tool-use' ? e.toolName : '')),
    ).toEqual(['Bash', 'Read', 'Bash']);
    const toolResult = events.find((e) => e.type === 'tool-result');
    expect(toolResult).toMatchObject({ toolUseId: 'tu_1', isError: false });

    // result terminal event.
    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      status: 'completed',
      agentSessionId: 'sess-abc',
      durationMs: 42_000,
    });
    expect(
      result?.type === 'result' ? result.usageTotals?.costEstimateUsd : 0,
    ).toBe(0.0123);
  });

  it('dedupes usage by message id (parallel tool use shares an id)', () => {
    const events = parseChunked(text, 10_000);
    const usage = events.filter((e) => e.type === 'usage');
    // Two distinct message ids (msg_1, msg_2) → exactly two usage events,
    // even though msg_1 appears on two assistant lines.
    expect(usage).toHaveLength(2);
    const first = usage[0];
    expect(first?.type === 'usage' ? first.inputTokens : 0).toBe(1200);
    expect(first?.type === 'usage' ? first.cacheReadTokens : 0).toBe(800);
  });

  it('is robust to mid-line chunk splits', () => {
    const whole = parseChunked(text, 10_000);
    for (const size of [1, 3, 7, 64]) {
      expect(parseChunked(text, size)).toEqual(whole);
    }
  });

  it('forwards unmapped system events as raw', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.feed(
      `${JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1 })}\n`,
    );
    expect(events[0]).toMatchObject({ type: 'raw', agent: 'claude-code' });
  });

  it('ignores malformed JSON lines without throwing', () => {
    const parser = new ClaudeCodeParser();
    expect(parser.feed('{not json\n')).toEqual([]);
  });
});
