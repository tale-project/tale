import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { PiParser } from './parse';

// Sanitized capture of a REAL headless turn (@earendil-works/pi-coding-agent
// 0.80.3, the sandbox-image pin) driven with the adapter's exact staged
// config (models.json custom provider + APPEND_SYSTEM.md + stdin prompt)
// against a mock OpenAI-completions gateway — session id, timestamps, and cwd
// neutralized, payload shapes verbatim (the bash tool call ran for real).
const FIXTURE = join(import.meta.dirname, '../fixtures/pi/shell-turn.jsonl');

function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new PiParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

function feedAll(lines: object[]): AgentEvent[] {
  const parser = new PiParser();
  const events = parser.feed(
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
  events.push(...parser.end());
  return events;
}

const assistantErrorEnd = (message: string) => ({
  type: 'message_end',
  message: {
    role: 'assistant',
    content: [],
    model: 'openrouter/anthropic/claude-sonnet-4.6',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage: message,
  },
});

describe('PiParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the real captured shell turn to normalized events', () => {
    const events = parseChunked(text, 10_000);

    const started = events.filter((e) => e.type === 'run-started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      type: 'run-started',
      agent: 'pi',
      agentSessionId: '0197f3c5-3f22-77e7-886f-2760868904b9',
    });

    const toolUses = events.filter((e) => e.type === 'tool-use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({
      type: 'tool-use',
      toolName: 'bash',
      input: { command: 'echo hello' },
    });
    const toolResults = events.filter((e) => e.type === 'tool-result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({
      type: 'tool-result',
      isError: false,
      output: { content: [{ type: 'text', text: 'hello\n' }] },
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
      agentSessionId: '0197f3c5-3f22-77e7-886f-2760868904b9',
      finalText: 'Mock turn complete: 2 + 2 = 4.',
      // Both model calls of the turn (tool-call cycle + reply cycle).
      usageTotals: { inputTokens: 57, outputTokens: 22 },
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
      expect(events.filter((e) => e.type === 'result')).toHaveLength(1);
    }
  });

  it('emits per-message usage with real token counts, never a zero-token one', () => {
    const usage = parseChunked(text, 10_000).filter((e) => e.type === 'usage');
    // One per assistant message_end that reached the model.
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      type: 'usage',
      inputTokens: 22,
      outputTokens: 9,
      model: 'openrouter/anthropic/claude-sonnet-4.6',
    });
    expect(usage[1]).toMatchObject({
      type: 'usage',
      inputTokens: 35,
      outputTokens: 13,
    });

    // A zero-token error message (e.g. auth failure before the first model
    // call) emits NO usage event.
    const zero = feedAll([assistantErrorEnd('nope'), { type: 'agent_end' }]);
    expect(zero.filter((e) => e.type === 'usage')).toEqual([]);
  });

  it("holds an error agent_end open for Pi's auto-retry, then finalizes once", () => {
    // Observed 0.80.3 behavior: a failed model call ends its cycle with a
    // normal agent_end, then auto_retry_start → a fresh cycle. Emitting an
    // error result at the FIRST agent_end would kill a turn the CLI was about
    // to save.
    const retried = feedAll([
      { type: 'session', version: 3, id: 'sid-1' },
      { type: 'agent_start' },
      assistantErrorEnd('Connection error.'),
      { type: 'agent_end' },
      { type: 'auto_retry_start', attempt: 1, maxAttempts: 3 },
      { type: 'agent_start' },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Recovered.' }],
          usage: {
            input: 10,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 12,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: 'stop',
        },
      },
      { type: 'agent_end' },
      { type: 'auto_retry_end', success: true, attempt: 1 },
    ]);
    const results = retried.filter((e) => e.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      status: 'completed',
      finalText: 'Recovered.',
    });

    // No retry follows → the stream end finalizes the held error.
    const terminal = feedAll([
      { type: 'session', version: 3, id: 'sid-2' },
      assistantErrorEnd('401 invalid api key'),
      { type: 'agent_end' },
    ]);
    const errResults = terminal.filter((e) => e.type === 'result');
    expect(errResults).toHaveLength(1);
    expect(errResults[0]).toMatchObject({
      type: 'result',
      status: 'error',
      isError: true,
    });
    expect(terminal).toContainEqual({
      type: 'error',
      message: '401 invalid api key',
    });
  });

  it('maps an aborted turn to cancelled and a wrapper failure to error', () => {
    const aborted = feedAll([
      {
        type: 'message_end',
        message: { role: 'assistant', content: [], stopReason: 'aborted' },
      },
      { type: 'agent_end' },
    ]);
    expect(aborted.find((e) => e.type === 'result')).toMatchObject({
      type: 'result',
      status: 'cancelled',
      isError: true,
    });

    const wrapper = feedAll([
      { type: 'wrapper_error', message: 'pi not installed' },
    ]);
    expect(wrapper).toContainEqual(
      expect.objectContaining({ type: 'error', message: 'pi not installed' }),
    );
    expect(wrapper.find((e) => e.type === 'result')).toMatchObject({
      type: 'result',
      status: 'error',
      isError: true,
    });
  });
});
