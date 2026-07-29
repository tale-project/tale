// codex-jsonl family tests. Parser expectations derive from the captured
// fixtures/codex/shell-turn.yml stream. Exec construction is covered by
// the golden fixtures + interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import { createParser } from './codex-jsonl';

describe('codex-jsonl parser', () => {
  it('normalizes the shell-turn stream', () => {
    const events = collectEvents(
      createParser('codex'),
      readFixture('codex', 'shell-turn'),
    );
    expect(events).toEqual([
      {
        type: 'turn-started',
        harness: 'codex',
        sessionId: '019f3b0c-4531-7313-877c-fd1078c809a4',
      },
      {
        type: 'tool-use',
        toolUseId: 'item_0',
        toolName: 'Bash',
        input: { command: "/bin/bash -lc 'echo hello-from-codex'" },
      },
      {
        type: 'tool-result',
        toolUseId: 'item_0',
        isError: false,
        output: { output: 'hello-from-codex\n', exitCode: 0 },
      },
      { type: 'text', text: 'Done: printed hello-from-codex.' },
      {
        type: 'usage',
        inputTokens: 320,
        outputTokens: 37,
        cacheReadTokens: 60,
      },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: '019f3b0c-4531-7313-877c-fd1078c809a4',
        finalText: 'Done: printed hello-from-codex.',
      },
    ]);
  });

  it('parses the shell-turn identically when fed in 7-byte chunks', () => {
    const text = readFixture('codex', 'shell-turn');
    expect(collectEvents(createParser('codex'), text, 7)).toEqual(
      collectEvents(createParser('codex'), text),
    );
  });

  it('maps turn.failed to an error and an errored turn-ended', () => {
    const text = `${[
      { type: 'thread.started', thread_id: 'thr-1' },
      { type: 'turn.failed', error: { message: 'model exploded' } },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    expect(collectEvents(createParser('codex'), text)).toEqual([
      { type: 'turn-started', harness: 'codex', sessionId: 'thr-1' },
      {
        type: 'error',
        message: 'model exploded',
        raw: { type: 'turn.failed', error: { message: 'model exploded' } },
      },
      {
        type: 'turn-ended',
        status: 'error',
        isError: true,
        sessionId: 'thr-1',
      },
    ]);
  });

  it('passes transient stream errors through as raw, never as error rows', () => {
    const line = { type: 'error', message: 'Reconnecting... 1/5' };
    expect(
      collectEvents(createParser('codex'), `${JSON.stringify(line)}\n`),
    ).toEqual([{ type: 'raw', harness: 'codex', payload: line }]);
  });

  it('synthesizes the tool-use for items that only ever complete', () => {
    const item = {
      id: 'item_9',
      type: 'mcp_tool_call',
      server: 'playwright',
      tool: 'browser_click',
      arguments: { ref: 'e1' },
      result: { ok: true },
      status: 'completed',
    };
    const text = `${[
      { type: 'thread.started', thread_id: 'thr-2' },
      { type: 'item.completed', item },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    expect(collectEvents(createParser('codex'), text)).toEqual([
      { type: 'turn-started', harness: 'codex', sessionId: 'thr-2' },
      {
        type: 'tool-use',
        toolUseId: 'item_9',
        toolName: 'mcp__playwright__browser_click',
        input: { ref: 'e1' },
      },
      {
        type: 'tool-result',
        toolUseId: 'item_9',
        isError: false,
        output: { ok: true },
      },
    ]);
  });

  it('passes reasoning items and unknown event types through as raw', () => {
    const reasoning = {
      type: 'item.started',
      item: { id: 'item_3', type: 'reasoning', text: 'thinking…' },
    };
    const unknown = { type: 'brand.new', x: 1 };
    const text = `${[reasoning, unknown]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    expect(collectEvents(createParser('codex'), text)).toEqual([
      // First item event also seeds the turn (no thread.started seen).
      { type: 'turn-started', harness: 'codex' },
      { type: 'raw', harness: 'codex', payload: reasoning.item },
      { type: 'raw', harness: 'codex', payload: unknown },
    ]);
  });
});
