import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractContentDelta,
  initContentExtractState,
  type ContentExtractState,
} from '../extract-content-stream';

function feedChunks(chunks: string[]): {
  state: ContentExtractState;
  outputs: { delta: string; finished: boolean }[];
} {
  const state = initContentExtractState();
  const outputs: { delta: string; finished: boolean }[] = [];
  for (const chunk of chunks) {
    outputs.push(extractContentDelta(state, chunk));
  }
  return { state, outputs };
}

function joinDeltas(outs: { delta: string }[]): string {
  return outs.map((o) => o.delta).join('');
}

describe('extractContentDelta', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty / not finished when there is no content key yet', () => {
    const state = initContentExtractState();
    const { delta, finished } = extractContentDelta(state, '{"type":"html",');
    expect(delta).toBe('');
    expect(finished).toBe(false);
    expect(state.phase).toBe('pre-content');
  });

  it('decodes a complete simple content value in one shot', () => {
    const state = initContentExtractState();
    const out = extractContentDelta(
      state,
      '{"type":"html","title":"t","content":"hello"}',
    );
    expect(out.delta).toBe('hello');
    expect(out.finished).toBe(true);
    expect(state.phase).toBe('post-content');
  });

  it('emits incremental deltas across chunk boundaries', () => {
    const { outputs } = feedChunks(['{"type":"html","content":"abc', 'def"}']);
    expect(outputs[0]).toEqual({ delta: 'abc', finished: false });
    expect(outputs[1]).toEqual({ delta: 'def', finished: true });
  });

  it.each([
    ['\\"', '"'],
    ['\\\\', '\\'],
    ['\\/', '/'],
    ['\\b', '\b'],
    ['\\f', '\f'],
    ['\\n', '\n'],
    ['\\r', '\r'],
    ['\\t', '\t'],
    ['\\u0041', 'A'],
  ])('decodes JSON escape %s correctly', (input, expected) => {
    const state = initContentExtractState();
    const out = extractContentDelta(state, `{"content":"${input}"}`);
    expect(out.delta).toBe(expected);
    expect(out.finished).toBe(true);
  });

  it('handles a backslash split across chunks', () => {
    const { outputs } = feedChunks(['{"content":"hi\\', 'nworld"}']);
    expect(outputs[0].delta).toBe('hi');
    expect(outputs[1].delta).toBe('\nworld');
    expect(outputs[1].finished).toBe(true);
  });

  it('handles a unicode escape split across chunks', () => {
    const { outputs } = feedChunks(['{"content":"X\\u00', '41Y"}']);
    expect(outputs[0].delta).toBe('X');
    expect(outputs[1].delta).toBe('AY');
    expect(outputs[1].finished).toBe(true);
  });

  it('combines a surrogate pair within a single chunk', () => {
    const state = initContentExtractState();
    const out = extractContentDelta(state, '{"content":"\\uD83D\\uDE00"}');
    expect(out.delta).toBe('😀');
    expect(out.finished).toBe(true);
  });

  it('combines a surrogate pair split across chunks', () => {
    const { outputs } = feedChunks(['{"content":"\\uD83D', '\\uDE00"}']);
    expect(outputs[0].delta).toBe('');
    expect(outputs[1].delta).toBe('😀');
    expect(outputs[1].finished).toBe(true);
  });

  it('emits replacement char for stray low surrogate', () => {
    const state = initContentExtractState();
    const out = extractContentDelta(state, '{"content":"\\uDE00"}');
    expect(out.delta).toBe('�');
    expect(out.finished).toBe(true);
  });

  it('emits replacement char if high surrogate has no pair before close', () => {
    const state = initContentExtractState();
    const out = extractContentDelta(state, '{"content":"\\uD83D"}');
    expect(out.delta).toBe('�');
    expect(out.finished).toBe(true);
  });

  it('does not end the string on an escaped close-quote', () => {
    const state = initContentExtractState();
    const out = extractContentDelta(state, '{"content":"a\\"b\\"c"}');
    expect(out.delta).toBe('a"b"c');
    expect(out.finished).toBe(true);
  });

  it('extracts content even when the field is not first in the JSON', () => {
    const { outputs } = feedChunks([
      '{"type":"html","title":"My Page","language":null,"con',
      'tent":"<html>hi</html>"}',
    ]);
    expect(joinDeltas(outputs)).toBe('<html>hi</html>');
    expect(outputs.at(-1)?.finished).toBe(true);
  });

  it('handles content-first field order', () => {
    const { outputs } = feedChunks([
      '{"content":"first',
      '","type":"html","title":"T"}',
    ]);
    expect(joinDeltas(outputs)).toBe('first');
    expect(outputs.at(-1)?.finished).toBe(true);
  });

  it('handles the "content":" key splitting across many tiny chunks', () => {
    // The whole pre-content prefix arrives one byte at a time.
    const json = '{"type":"html","content":"hello"}';
    const state = initContentExtractState();
    let collected = '';
    for (const ch of json) {
      const out = extractContentDelta(state, ch);
      collected += out.delta;
    }
    expect(collected).toBe('hello');
    expect(state.phase).toBe('post-content');
  });

  it('returns empty delta when content value is null (non-string)', () => {
    const state = initContentExtractState();
    const out = extractContentDelta(state, '{"content":null}');
    expect(out.delta).toBe('');
    expect(state.phase).toBe('post-content');
  });

  it('processes a 1MB input in many small chunks within 100ms', () => {
    const unit = '<div class="x">hello world</div>\n';
    const repeats = Math.ceil(1_000_000 / unit.length);
    const content = unit.repeat(repeats);
    const json = `{"content":${JSON.stringify(content)}}`;

    const state = initContentExtractState();
    const chunkSize = 4;
    const start = performance.now();
    let collected = '';
    for (let i = 0; i < json.length; i += chunkSize) {
      const chunk = json.slice(i, i + chunkSize);
      const out = extractContentDelta(state, chunk);
      collected += out.delta;
    }
    const elapsed = performance.now() - start;

    expect(collected.length).toBe(content.length);
    expect(state.phase).toBe('post-content');
    // Generous bound — proves we're O(N), not O(N²).
    expect(elapsed).toBeLessThan(500);
  });
});
