// The harness event stream projected onto the op row's transcript shape —
// what the run views render as the agent's sandbox execution log. Tool
// results must fold into their call, payloads must stay bounded, and the tail
// must keep the NEWEST entries (a long turn is still readable).

import { describe, expect, it } from 'vitest';

import { timelineFromEvents } from './external_turn_shared';

describe('timelineFromEvents', () => {
  it('folds a tool result into its call and keeps text blocks', () => {
    const parts = timelineFromEvents([
      { type: 'text-delta', text: 'Reading ' },
      { type: 'text-delta', text: 'the invoices.' },
      {
        type: 'tool-use',
        toolUseId: 't1',
        toolName: 'Read',
        input: { file_path: '/user/workspace/input/a.pdf' },
      },
      { type: 'tool-result', toolUseId: 't1', output: 'ok' },
    ]);
    expect(parts).toEqual([
      { type: 'text', text: 'Reading the invoices.' },
      {
        type: 'tool-Read',
        state: 'output-available',
        toolCallId: 't1',
        input: { file_path: '/user/workspace/input/a.pdf' },
        output: 'ok',
      },
    ]);
  });

  it('never prints the same words twice when a harness sends deltas AND blocks', () => {
    // claude-code streams deltas and then emits the finished block for the
    // same sentence; consuming both duplicated every paragraph in the log.
    const parts = timelineFromEvents([
      { type: 'text-delta', text: 'All 9 sidecars match' },
      { type: 'text-delta', text: ' — skipping them.' },
      { type: 'text', text: 'All 9 sidecars match — skipping them.' },
    ]);
    expect(parts).toEqual([
      { type: 'text', text: 'All 9 sidecars match — skipping them.' },
    ]);
  });

  it('falls back to text blocks for a harness that streams none', () => {
    const parts = timelineFromEvents([
      { type: 'text', text: 'first thought' },
      { type: 'text', text: 'second thought' },
    ]);
    expect(parts).toEqual([
      { type: 'text', text: 'first thought\n\nsecond thought' },
    ]);
  });

  it('marks a failed tool call with its error text', () => {
    const parts = timelineFromEvents([
      {
        type: 'tool-use',
        toolUseId: 't1',
        toolName: 'Bash',
        input: 'ls /nope',
      },
      {
        type: 'tool-result',
        toolUseId: 't1',
        output: 'no such directory',
        isError: true,
      },
    ]);
    expect(parts[0]).toMatchObject({
      type: 'tool-Bash',
      state: 'output-error',
      errorText: 'no such directory',
    });
    expect(parts[0]).not.toHaveProperty('output');
  });

  it('leaves an unfinished call in its input-available state', () => {
    const parts = timelineFromEvents([
      { type: 'tool-use', toolUseId: 't1', toolName: 'Grep', input: 'Levy' },
    ]);
    expect(parts[0]).toMatchObject({
      type: 'tool-Grep',
      state: 'input-available',
    });
  });

  it('clamps an oversized payload instead of carrying it whole', () => {
    const parts = timelineFromEvents([
      {
        type: 'tool-use',
        toolUseId: 't1',
        toolName: 'Write',
        input: { content: 'x'.repeat(10_000) },
      },
    ]);
    const input = parts[0]?.input;
    expect(typeof input).toBe('string');
    expect((input as string).length).toBeLessThan(2_100);
    expect(input as string).toMatch(/…$/);
  });

  it('keeps the NEWEST entries when the transcript runs long', () => {
    const parts = timelineFromEvents(
      Array.from({ length: 60 }, (_, index) => ({
        type: 'tool-use' as const,
        toolUseId: `t${String(index)}`,
        toolName: `Tool${String(index)}`,
        input: {},
      })),
    );
    expect(parts).toHaveLength(40);
    expect(parts.at(-1)?.toolCallId).toBe('t59');
    expect(parts[0]?.toolCallId).toBe('t20');
  });

  it('keeps the TAIL of an overlong text block', () => {
    const parts = timelineFromEvents([
      { type: 'text-delta', text: `${'a'.repeat(9000)}THE-END` },
    ]);
    const text = parts[0]?.text ?? '';
    expect(text.length).toBeLessThan(4_100);
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('THE-END')).toBe(true);
  });

  it('ignores tool results whose call was already trimmed away', () => {
    expect(
      timelineFromEvents([{ type: 'tool-result', toolUseId: 'gone' }]),
    ).toEqual([]);
  });
});
