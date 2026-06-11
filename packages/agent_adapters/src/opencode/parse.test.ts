import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { OpenCodeParser } from './parse';

const FIXTURE = join(
  import.meta.dirname,
  '../../fixtures/opencode/issue-to-pr.jsonl',
);

function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new OpenCodeParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

describe('OpenCodeParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the full issue→PR stream to normalized events', () => {
    const events = parseChunked(text, 10_000);

    // run-started emitted exactly once, from the first event with a sessionID.
    const started = events.filter((e) => e.type === 'run-started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      agent: 'opencode',
      agentSessionId: 'ses_xyz',
    });

    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => (e.type === 'text' ? e.text : '')),
    ).toEqual(['Implementing the fix.', 'Opening the PR.']);

    // running tool_use → tool-use; completed/error → tool-result.
    const toolUse = events.find((e) => e.type === 'tool-use');
    expect(toolUse).toMatchObject({ toolName: 'bash', toolUseId: 'call_1' });
    const results = events.filter((e) => e.type === 'tool-result');
    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({ toolUseId: 'call_2', isError: true });

    // usage per step_finish; reasoning folded into outputTokens.
    const usage = events.filter((e) => e.type === 'usage');
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      inputTokens: 900,
      outputTokens: 50, // 40 output + 10 reasoning
      cacheReadTokens: 500,
      costEstimateUsd: 0.0042,
    });

    // terminal step_finish reason "stop" → result.
    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({
      status: 'completed',
      agentSessionId: 'ses_xyz',
    });
    expect(
      result?.type === 'result' ? result.usageTotals?.costEstimateUsd : 0,
    ).toBe(0.0061);
  });

  it('is robust to mid-line chunk splits', () => {
    const whole = parseChunked(text, 10_000);
    for (const size of [1, 5, 33]) {
      expect(parseChunked(text, size)).toEqual(whole);
    }
  });

  it('maps an error event', () => {
    const parser = new OpenCodeParser();
    const events = parser.feed(
      `${JSON.stringify({ type: 'error', error: { name: 'ProviderError', data: { message: 'rate limited' } } })}\n`,
    );
    expect(events[0]).toMatchObject({ type: 'error', message: 'rate limited' });
  });
});
