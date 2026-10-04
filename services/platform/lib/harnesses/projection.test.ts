import { describe, expect, it } from 'vitest';

import { HARNESS_RECORD_MAX_CHARS } from './jsonl';
import { HarnessProjection, HARNESS_TEXT_MAX_CHARS } from './projection';
import { TIMELINE_MAX_ENTRIES, TIMELINE_MAX_JSON_BYTES } from './timeline';

describe('bounded harness display projection', () => {
  it('serializes a large tool payload once as it arrives, never per snapshot', () => {
    const p = new HarnessProjection();
    let serialized = 0;
    p.accept({
      type: 'tool-use',
      toolUseId: 'huge',
      toolName: 'read',
      input: {
        toJSON: () => {
          serialized++;
          return 'x'.repeat(100_000);
        },
      },
    });
    p.timeline();
    p.timeline();
    expect(serialized).toBe(1);
  });

  it('keeps an exact bounded terminal fallback independently of its display tail', () => {
    const p = new HarnessProjection();
    const first = 'BEGIN ' + 'a'.repeat(70_000);
    p.accept({ type: 'text', text: first });
    p.accept({ type: 'text', text: 'END' });
    expect(p.answer).toBe(`${first}\n\nEND`);
    expect(p.text.length).toBe(HARNESS_TEXT_MAX_CHARS);
    p.accept({ type: 'text-delta', text: 'ACTUAL ' });
    p.accept({ type: 'text', text: 'duplicate completed text' });
    p.accept({ type: 'text-delta', text: first });
    expect(p.answer).toBe(`ACTUAL ${first}`);
  });

  it('refuses an excessive fallback answer rather than returning a successful truncated value', () => {
    const p = new HarnessProjection();
    p.accept({
      type: 'text-delta',
      text: 'x'.repeat(HARNESS_RECORD_MAX_CHARS),
    });
    expect(() => p.accept({ type: 'text-delta', text: '!' })).toThrow(
      'final answer exceeds',
    );
  });

  it('refuses huge tool identifiers instead of retaining an oversized singleton entry', () => {
    const p = new HarnessProjection();
    expect(() =>
      p.accept({
        type: 'tool-use',
        toolUseId: 'x'.repeat(1025),
        toolName: 'read',
        input: {},
      }),
    ).toThrow('identifier exceeds');
    expect(() =>
      p.accept({
        type: 'tool-use',
        toolUseId: 't',
        toolName: 'x'.repeat(257),
        input: {},
      }),
    ).toThrow('identifier exceeds');
    expect(p.timeline()).toEqual([]);
  });
  it('prefers streamed deltas over duplicate completed text, preserving tools', () => {
    const p = new HarnessProjection();
    p.accept({ type: 'text', text: 'duplicate preamble' });
    p.accept({
      type: 'tool-use',
      toolUseId: 't',
      toolName: 'bash',
      input: { command: 'ls' },
    });
    p.accept({ type: 'text-delta', text: 'actual ' });
    p.accept({ type: 'text-delta', text: 'answer' });
    p.accept({ type: 'text', text: 'actual answer' });
    p.accept({ type: 'tool-result', toolUseId: 't', output: 'files' });
    expect(p.text).toBe('actual answer');
    expect(p.timeline()).toEqual([
      {
        type: 'tool-bash',
        toolCallId: 't',
        state: 'output-available',
        input: { command: 'ls' },
        output: 'files',
      },
      { type: 'text', text: 'actual answer' },
    ]);
  });

  it('keeps issued snapshots immutable when text and tool results advance', () => {
    const p = new HarnessProjection();
    p.accept({ type: 'tool-use', toolUseId: 't', toolName: 'bash', input: {} });
    p.accept({ type: 'text-delta', text: 'a' });
    const first = p.timeline();
    p.accept({ type: 'tool-result', toolUseId: 't', output: 'done' });
    p.accept({ type: 'text-delta', text: 'b' });
    expect(first[0]?.state).toBe('input-available');
    expect(first[1]?.text).toBe('a');
    expect(p.timeline()[1]?.text).toBe('ab');
  });

  it('bounds tool payloads and every projection throughout a long replay', () => {
    const p = new HarnessProjection();
    for (let n = 0; n < 2_000; n++) {
      p.accept({
        type: 'tool-use',
        toolUseId: `t-${n}`,
        toolName: 'read',
        input: 'x'.repeat(12_000),
      });
      p.accept({
        type: 'tool-result',
        toolUseId: `t-${n}`,
        output: 'y'.repeat(12_000),
      });
    }
    const timeline = p.timeline();
    expect(timeline.length).toBeLessThanOrEqual(TIMELINE_MAX_ENTRIES);
    expect(Buffer.byteLength(JSON.stringify(timeline))).toBeLessThanOrEqual(
      TIMELINE_MAX_JSON_BYTES + TIMELINE_MAX_ENTRIES + 1,
    );
    expect(timeline.at(-1)?.toolCallId).toBe('t-1999');
    expect(String(timeline.at(-1)?.input).length).toBeLessThanOrEqual(2001);
    // A result for an evicted tool must not recreate an old entry.
    p.accept({ type: 'tool-result', toolUseId: 't-0', output: 'late' });
    expect(p.timeline()).toEqual(timeline);
  });

  it('retains a bounded text tail, while raw events retain nothing', () => {
    const p = new HarnessProjection();
    for (let n = 0; n < 100; n++) {
      p.accept({ type: 'text-delta', text: 'x'.repeat(10_000) });
      p.accept({
        type: 'raw',
        harness: 'claude-code',
        payload: 'y'.repeat(10_000),
      });
    }
    p.accept({ type: 'text-delta', text: 'THE END' });
    expect(p.text.length).toBe(HARNESS_TEXT_MAX_CHARS);
    expect(p.text.startsWith('…')).toBe(true);
    expect(p.text.endsWith('THE END')).toBe(true);
    expect(p.timeline()).toHaveLength(1);
    expect(p.timeline()[0]?.text?.length).toBe(4000);
  });
});
