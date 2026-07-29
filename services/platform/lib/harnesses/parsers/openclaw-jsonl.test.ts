// openclaw-jsonl family tests. Parser expectations derive from the captured
// fixtures/openclaw/hello-turn.yml stream (the tale-openclaw-run dialect —
// the CLI itself emits one final envelope, so the wrapper owns the
// lifecycle events). Exec construction is covered by the golden fixtures +
// interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import { createParser } from './openclaw-jsonl';

const SESSION = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('openclaw-jsonl parser', () => {
  it('normalizes the hello-turn stream', () => {
    const events = collectEvents(
      createParser('openclaw'),
      readFixture('openclaw', 'hello-turn'),
    );
    expect(events).toEqual([
      {
        type: 'turn-started',
        harness: 'openclaw',
        sessionId: SESSION,
        model: 'tale/openrouter/anthropic/claude-sonnet-4.6',
      },
      { type: 'text', text: 'Hello from the mock model! Nothing else to do.' },
      {
        type: 'usage',
        inputTokens: 128,
        outputTokens: 12,
        model: 'openrouter/anthropic/claude-sonnet-4.6',
      },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: SESSION,
        finalText: 'Hello from the mock model! Nothing else to do.',
        durationMs: 1295,
      },
    ]);
  });

  it('parses the hello-turn identically when fed in 7-byte chunks', () => {
    const text = readFixture('openclaw', 'hello-turn');
    expect(collectEvents(createParser('openclaw'), text, 7)).toEqual(
      collectEvents(createParser('openclaw'), text),
    );
  });

  it('maps an errored run_end and keeps cache-token detail on usage', () => {
    const text = `${[
      { type: 'run_start', session_id: 'oc-1' },
      { type: 'usage', input: 10, output: 5, cache_read: 3, cache_write: 2 },
      { type: 'run_end', status: 'error', error: 'provider kaput' },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    const events = collectEvents(createParser('openclaw'), text);
    expect(events[1]).toEqual({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    });
    expect(events[2]).toMatchObject({
      type: 'error',
      message: 'provider kaput',
    });
    expect(events[3]).toEqual({
      type: 'turn-ended',
      status: 'error',
      sessionId: 'oc-1',
      isError: true,
    });
  });

  it('suppresses zero-token usage and passes unknown events through as raw', () => {
    const unknown = { type: 'novel_openclaw_event', v: 9 };
    const text = `${[{ type: 'usage', input: 0, output: 0 }, unknown]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    const events = collectEvents(createParser('openclaw'), text);
    // The zero-usage line only seeds the turn; no usage row.
    expect(events).toEqual([
      { type: 'turn-started', harness: 'openclaw' },
      { type: 'raw', harness: 'openclaw', payload: unknown },
    ]);
  });
});
