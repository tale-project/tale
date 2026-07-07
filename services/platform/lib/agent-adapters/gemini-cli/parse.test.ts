import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { GeminiCliParser } from './parse';

// Sanitized capture of a REAL headless turn (@google/gemini-cli 0.49.0, the
// sandbox-image pin) driven with the adapter's exact settings against a mock
// GenAI gateway — session/tool ids and timestamps neutralized, payload shapes
// verbatim (the tool_use/tool_result envelopes, the result stats block).
const FIXTURE = join(
  import.meta.dirname,
  '../fixtures/gemini/shell-turn.jsonl',
);

function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new GeminiCliParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

describe('GeminiCliParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the real captured shell turn to normalized events', () => {
    const events = parseChunked(text, 10_000);

    const started = events.filter((e) => e.type === 'run-started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      type: 'run-started',
      agent: 'gemini',
      agentSessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      model: 'gemini-2.5-pro',
    });

    const toolUses = events.filter((e) => e.type === 'tool-use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({
      type: 'tool-use',
      toolName: 'run_shell_command',
      input: { command: 'echo hello' },
    });
    const toolResults = events.filter((e) => e.type === 'tool-result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({
      type: 'tool-result',
      isError: false,
      output: 'hello',
    });
    expect(
      toolUses[0]?.type === 'tool-use' &&
        toolResults[0]?.type === 'tool-result' &&
        toolUses[0].toolUseId === toolResults[0].toolUseId,
    ).toBe(true);

    const deltas = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => (e.type === 'text-delta' ? e.text : ''));
    expect(deltas.join('')).toBe('Mock turn complete: 2 + 2 = 4.');

    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      status: 'completed',
      agentSessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      finalText: 'Mock turn complete: 2 + 2 = 4.',
      durationMs: 68,
      usageTotals: { inputTokens: 22, outputTokens: 13 },
    });
  });

  it('does not surface the CLI echo of the user prompt as agent output', () => {
    const events = parseChunked(text, 10_000);
    const texts = events.filter(
      (e) => e.type === 'text' || e.type === 'text-delta',
    );
    expect(
      texts.every(
        (e) =>
          (e.type === 'text' || e.type === 'text-delta') &&
          !e.text.includes('Run echo hello'),
      ),
    ).toBe(true);
  });

  it('is robust to pathological mid-line chunk splits', () => {
    for (const chunkSize of [1, 7, 13, 37, 256]) {
      const events = parseChunked(text, chunkSize);
      expect(events.filter((e) => e.type === 'run-started')).toHaveLength(1);
      expect(events.filter((e) => e.type === 'tool-use')).toHaveLength(1);
      expect(events.some((e) => e.type === 'result')).toBe(true);
    }
  });

  it('emits one usage event with real token counts, never a zero-token one', () => {
    const usage = parseChunked(text, 10_000).filter((e) => e.type === 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      type: 'usage',
      inputTokens: 22,
      outputTokens: 13,
    });

    // A zero-token error result (e.g. auth failure before the first model
    // call) emits NO usage event.
    const zero = new GeminiCliParser().feed(
      JSON.stringify({
        type: 'result',
        status: 'error',
        error: { type: 'auth', message: 'nope' },
        stats: {
          total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached: 0,
          input: 0,
          duration_ms: 5,
          tool_calls: 0,
          models: {},
        },
      }) + '\n',
    );
    expect(zero.filter((e) => e.type === 'usage')).toEqual([]);
  });

  it("maps the turn-cap error to max-turns but not every error mentioning 'max'", () => {
    const runResult = (message: string) =>
      new GeminiCliParser()
        .feed(
          JSON.stringify({
            type: 'result',
            status: 'error',
            error: { type: 'turn-limit', message },
          }) + '\n',
        )
        .find((e) => e.type === 'result');

    expect(
      runResult(
        'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
      ),
    ).toMatchObject({ type: 'result', status: 'max-turns', isError: true });

    expect(runResult('max_tokens exceeded for this request')).toMatchObject({
      type: 'result',
      status: 'error',
    });
  });
});
