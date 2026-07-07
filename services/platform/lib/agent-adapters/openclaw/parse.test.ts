import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { OpenClawParser } from './parse';

// Sanitized capture of a REAL headless turn (openclaw 2026.6.11, the
// sandbox-image pin) driven through tale-openclaw-run with the adapter's
// exact generated config against a mock OpenAI-compatible gateway — session
// id and timestamps neutralized, event shapes verbatim.
const FIXTURE = join(
  import.meta.dirname,
  '../fixtures/openclaw/hello-turn.jsonl',
);

function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new OpenClawParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

describe('OpenClawParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the real captured turn to normalized events', () => {
    const events = parseChunked(text, 10_000);

    const started = events.filter((e) => e.type === 'run-started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      type: 'run-started',
      agent: 'openclaw',
      agentSessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      model: 'tale/openrouter/anthropic/claude-sonnet-4.6',
    });

    const texts = events.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({
      type: 'text',
      text: 'Hello from the mock model! Nothing else to do.',
    });

    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      status: 'completed',
      agentSessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      finalText: 'Hello from the mock model! Nothing else to do.',
      durationMs: 1295,
    });
  });

  it('is robust to pathological mid-line chunk splits', () => {
    for (const chunkSize of [1, 7, 13, 37, 256]) {
      const events = parseChunked(text, chunkSize);
      expect(events.filter((e) => e.type === 'run-started')).toHaveLength(1);
      expect(events.filter((e) => e.type === 'text')).toHaveLength(1);
      expect(events.some((e) => e.type === 'result')).toBe(true);
    }
  });

  it('emits one usage event with real token counts, never a zero-token one', () => {
    const usage = parseChunked(text, 10_000).filter((e) => e.type === 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      type: 'usage',
      inputTokens: 128,
      outputTokens: 12,
      model: 'openrouter/anthropic/claude-sonnet-4.6',
    });

    // A zero-token error run (e.g. auth failure before the first model call)
    // emits NO usage event.
    const zero = new OpenClawParser().feed(
      JSON.stringify({ type: 'usage', input: 0, output: 0 }) + '\n',
    );
    expect(zero.filter((e) => e.type === 'usage')).toEqual([]);
  });

  it('maps a wrapper error run_end to an error event + error result', () => {
    const events = new OpenClawParser().feed(
      JSON.stringify({
        type: 'run_end',
        status: 'error',
        session_id: 'sess-err',
        error: 'openclaw exited with code 1',
      }) + '\n',
    );
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      type: 'error',
      message: 'openclaw exited with code 1',
    });
    expect(events.find((e) => e.type === 'result')).toMatchObject({
      type: 'result',
      status: 'error',
      isError: true,
      agentSessionId: 'sess-err',
    });
  });

  it('passes unknown event types through as raw (forward compat)', () => {
    const events = new OpenClawParser().feed(
      JSON.stringify({ type: 'future_event', detail: 42 }) + '\n',
    );
    expect(events.filter((e) => e.type === 'raw')).toHaveLength(1);
  });
});
