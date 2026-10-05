import assert from 'node:assert/strict';

import { describe, expect, it, vi } from 'vitest';

import { BoundedTextTail } from './bounded-text-tail';
import { textTail } from './projection';

const jsonBytes = (value: string) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

function checkFragments(
  maxChars: number,
  fragments: readonly string[],
  measureJsonBytes = true,
): void {
  const tail = new BoundedTextTail(maxChars, measureJsonBytes);
  let expected = '';
  for (const fragment of fragments) {
    expected = textTail(expected + fragment, maxChars);
    tail.append(fragment);
    assert.equal(tail.length, expected.length);
    if (measureJsonBytes) assert.equal(tail.jsonBytes, jsonBytes(expected));
    assert.equal(tail.text, expected);
    assert.equal(tail.text, expected);
  }
}

describe('bounded UTF-16 text tail', () => {
  it('matches exact boundaries, empty appends, repeated overflow and oversized bursts', () => {
    for (const maxChars of [2, 3, 31, 4000, 65_536]) {
      checkFragments(maxChars, [
        '',
        'x'.repeat(maxChars - 1),
        '',
        'y',
        'z',
        '',
        'end',
        'a'.repeat(maxChars * 3),
        'b'.repeat(maxChars - 1),
        '…',
      ]);
    }
  });

  it('counts every JSON escape and Unicode code unit exactly', () => {
    const units = Array.from({ length: 65_536 }, (_, unit) =>
      String.fromCharCode(unit),
    );
    const all = units.join('');
    checkFragments(
      65_536,
      Array.from({ length: 256 }, (_, index) =>
        all.slice(index * 256, (index + 1) * 256),
      ),
    );
  });

  it('preserves split pairs and lone surrogates across both eviction boundaries', () => {
    const fragments = [
      '\ud800',
      '\udc00',
      '\ud800',
      'x',
      '\udfff',
      '\udbff\udfff',
      '😀',
      '\ud800\ud800\udc00\udc00',
      '\u0000\b\t\n\f\r"\\é界',
      '…',
      '',
    ];
    for (const maxChars of [2, 3, 4, 7, 31, 257])
      checkFragments(
        maxChars,
        Array.from({ length: 100 }, () => fragments).flat(),
      );
  });

  it('matches a deterministic fragmented Unicode stream through buffer growth and wraparound', () => {
    let seed = 0x12345678;
    const fragments = Array.from({ length: 2500 }, (_, index) => {
      const units: number[] = [];
      for (let n = 0; n < index % 37; n++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        units.push(seed & 0xffff);
      }
      return String.fromCharCode(...units);
    });
    for (const maxChars of [31, 4000, 65_536])
      checkFragments(maxChars, fragments);
  });

  it('rejects an invalid capacity', () => {
    for (const size of [0, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => new BoundedTextTail(size)).toThrow(RangeError);
  });

  it('preserves exact text with byte accounting disabled and refuses an unavailable metric', () => {
    const fragments = Array.from({ length: 200 }, () => [
      'a'.repeat(257),
      '\ud800',
      '\udc00',
      '',
      '界😀',
      'b'.repeat(1024),
    ]).flat();
    for (const maxChars of [2, 31, 4000, 65_536])
      checkFragments(maxChars, fragments, false);
    const tail = new BoundedTextTail(31, false);
    tail.append('text');
    expect(() => tail.jsonBytes).toThrow('JSON byte accounting is disabled');
  });

  it('materializes only newly appended units after a previous snapshot', () => {
    const tail = new BoundedTextTail(65_536);
    tail.append('a'.repeat(65_536));
    expect(tail.text).toBe('a'.repeat(65_536));
    const materialize = vi.spyOn(String, 'fromCharCode');
    let text = '';
    let units = 0;
    try {
      tail.append('b'.repeat(4096));
      text = tail.text;
      units = materialize.mock.calls.reduce(
        (total, call) => total + call.length,
        0,
      );
    } finally {
      materialize.mockRestore();
    }
    expect(units).toBe(4096);
    expect(text).toBe(`…${'a'.repeat(65_536 - 4096 - 1)}${'b'.repeat(4096)}`);
  });
});
