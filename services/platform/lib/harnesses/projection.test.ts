import { describe, expect, it, vi } from 'vitest';

import { HARNESS_RECORD_MAX_CHARS } from './jsonl';
import {
  HarnessProjection,
  HARNESS_TEXT_MAX_CHARS,
  HARNESS_TIMELINE_MAX_JSON_BYTES,
  textTail,
} from './projection';
import {
  TIMELINE_MAX_ENTRIES,
  TIMELINE_MAX_JSON_BYTES,
  type TimelinePart,
} from './timeline';

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

  it('preserves the complete fallback across serialized checkpoints and later deltas', () => {
    const first = new HarnessProjection();
    const prefix = 'BEGIN ' + 'a'.repeat(70_000);
    first.accept({ type: 'text-delta', text: prefix });
    const resumed = new HarnessProjection();
    resumed.restore(JSON.parse(JSON.stringify(first.snapshot())));
    resumed.accept({ type: 'text-delta', text: ' END' });
    expect(resumed.answer).toBe(`${prefix} END`);
    expect(resumed.text.length).toBe(HARNESS_TEXT_MAX_CHARS);
  });

  it('restores older complete checkpoints into the smaller display budget without losing the answer', () => {
    const text = 'BEGIN ' + 'x'.repeat(60_000) + ' END';
    const restored = new HarnessProjection();
    restored.restore({
      text,
      streamsDeltas: true,
      parts: [],
      textTruncated: false,
    });
    expect(restored.text.length).toBe(HARNESS_TEXT_MAX_CHARS);
    expect(restored.textTruncated).toBe(true);
    expect(restored.answer).toBe(text);
    const resumed = new HarnessProjection();
    resumed.restore(JSON.parse(JSON.stringify(restored.snapshot())));
    resumed.accept({ type: 'text-delta', text: ' later' });
    expect(resumed.answer).toBe(`${text} later`);
    expect(resumed.text.length).toBe(HARNESS_TEXT_MAX_CHARS);
  });

  it('restores lazy text buffers across split surrogates without mutating issued checkpoints', () => {
    const original = new HarnessProjection();
    const prefix = 'BEGIN ' + '\u0000'.repeat(70_000) + '\ud800';
    original.accept({ type: 'text-delta', text: prefix });
    const checkpoint = original.snapshot();
    const checkpointJson = JSON.stringify(checkpoint);
    const resumed = new HarnessProjection();
    resumed.restore(JSON.parse(checkpointJson));
    for (const p of [original, resumed]) {
      p.accept({ type: 'text-delta', text: '\udc00\n"\\界' });
      p.accept({
        type: 'tool-use',
        toolUseId: 't',
        toolName: 'read',
        input: {},
      });
      p.accept({ type: 'text-delta', text: 'after tool\ud800' });
      p.accept({ type: 'tool-result', toolUseId: 't', output: 'done' });
      p.accept({ type: 'text-delta', text: '\udc00 END' });
    }
    expect(resumed.snapshot()).toEqual(original.snapshot());
    expect(resumed.answer).toBe(
      `${prefix}\udc00\n"\\界after tool\ud800\udc00 END`,
    );
    expect(resumed.textTruncated).toBe(true);
    expect(JSON.stringify(checkpoint)).toBe(checkpointJson);
  });

  it('replaces existing lazy buffers on restore and continues completed-text separators', () => {
    const initial = new HarnessProjection();
    initial.accept({ type: 'text', text: 'saved' });
    const resumed = new HarnessProjection();
    resumed.accept({ type: 'text-delta', text: 'stale'.repeat(20_000) });
    resumed.restore(initial.snapshot());
    resumed.accept({ type: 'text', text: '' });
    resumed.accept({ type: 'text', text: 'next' });
    expect(resumed.text).toBe('saved\n\n\n\nnext');
    expect(resumed.answer).toBe(resumed.text);
    expect(resumed.textTruncated).toBe(false);
    expect(resumed.timeline()).toEqual([
      { type: 'text', text: 'saved\n\nnext' },
    ]);
  });

  it('never promotes an older truncated checkpoint tail to an exact answer', () => {
    const resumed = new HarnessProjection();
    resumed.restore({
      text: '…tail',
      textTruncated: true,
      streamsDeltas: true,
      parts: [],
    });
    resumed.accept({ type: 'text-delta', text: ' later' });
    expect(resumed.answer).toBeUndefined();
    const next = new HarnessProjection();
    next.restore(JSON.parse(JSON.stringify(resumed.snapshot())));
    expect(next.answer).toBeUndefined();
    const intact = new HarnessProjection();
    intact.restore({ text: 'complete', streamsDeltas: false, parts: [] });
    expect(intact.answer).toBe('complete');
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

  it('preserves empty completed-text separators and materializes unsampled historical blocks', () => {
    const p = new HarnessProjection();
    for (const text of ['', 'hello', '', 'world'])
      p.accept({ type: 'text', text });
    p.accept({ type: 'tool-use', toolUseId: 't', toolName: 'read', input: {} });
    p.accept({ type: 'text', text: 'after tool' });
    expect(p.text).toBe('hello\n\n\n\nworld\n\nafter tool');
    expect(p.timeline().map((part) => part.text)).toEqual([
      'hello\n\nworld',
      undefined,
      'after tool',
    ]);
    p.accept({ type: 'text-delta', text: '' });
    expect(p.text).toBe('');
    expect(p.timeline()).toEqual([
      {
        type: 'tool-read',
        toolCallId: 't',
        state: 'input-available',
        input: {},
      },
    ]);
    expect(p.revision).toBe(7);
  });

  it('evicts the exact byte-budget prefix for escaped text and split surrogates', () => {
    let p = new HarnessProjection();
    const expected: { part: TimelinePart; bytes: number }[] = [];
    let bytes = 0;
    const sizeOf = (part: TimelinePart) =>
      Buffer.byteLength(JSON.stringify(part));
    const bound = () => {
      while (
        expected.length > 1 &&
        (bytes > HARNESS_TIMELINE_MAX_JSON_BYTES ||
          expected.length > TIMELINE_MAX_ENTRIES)
      ) {
        const dropped = expected.shift();
        if (dropped !== undefined) bytes -= dropped.bytes;
      }
    };
    const append = (part: TimelinePart) => {
      const entry = { part, bytes: sizeOf(part) };
      expected.push(entry);
      bytes += entry.bytes;
      bound();
      return entry;
    };
    const saved: { parts: TimelinePart[]; json: string }[] = [];
    for (let n = 0; n < 100; n++) {
      p.accept({
        type: 'tool-use',
        toolUseId: `t-${n}`,
        toolName: 'read',
        input: {},
      });
      append({
        type: 'tool-read',
        toolCallId: `t-${n}`,
        state: 'input-available',
        input: {},
      });
      let text = '\u0000'.repeat(3999) + '\ud800';
      p.accept({ type: 'text-delta', text });
      const current = append({ type: 'text', text });
      for (const delta of ['\udc00', '界', '\ud800']) {
        p.accept({ type: 'text-delta', text: delta });
        text = textTail(text + delta, 4000);
        bytes -= current.bytes;
        current.part = { type: 'text', text };
        current.bytes = sizeOf(current.part);
        bytes += current.bytes;
        bound();
      }
      const actual = p.timeline();
      expect(actual).toEqual(expected.map((entry) => entry.part));
      if (n % 10 === 0)
        saved.push({ parts: actual, json: JSON.stringify(actual) });
      const restored = new HarnessProjection();
      restored.restore(JSON.parse(JSON.stringify(p.snapshot())));
      p = restored;
    }
    expect(p.timeline()[0]?.toolCallId).not.toBe('t-0');
    for (const snapshot of saved)
      expect(JSON.stringify(snapshot.parts)).toBe(snapshot.json);
  });

  it('does no retained-tail serialization or string materialization between snapshots', () => {
    const p = new HarnessProjection();
    const stringify = vi.spyOn(JSON, 'stringify');
    const materialize = vi.spyOn(String, 'fromCharCode');
    let beforeRead = 0;
    let afterRead = 0;
    let afterCachedRead = 0;
    let serialized = 0;
    let text = '';
    let timeline: TimelinePart[] = [];
    try {
      for (let n = 0; n < 100_000; n++)
        p.accept({ type: 'text-delta', text: 'x' });
      beforeRead = materialize.mock.calls.length;
      text = p.text;
      timeline = p.timeline();
      afterRead = materialize.mock.calls.length;
      void p.text;
      p.timeline();
      afterCachedRead = materialize.mock.calls.length;
      serialized = stringify.mock.calls.length;
    } finally {
      stringify.mockRestore();
      materialize.mockRestore();
    }
    expect(serialized).toBe(0);
    expect(beforeRead).toBe(0);
    expect(afterRead).toBeGreaterThan(0);
    expect(afterCachedRead).toBe(afterRead);
    expect(text).toBe(`…${'x'.repeat(HARNESS_TEXT_MAX_CHARS - 1)}`);
    expect(timeline).toEqual([{ type: 'text', text: `…${'x'.repeat(3999)}` }]);
  });
});
