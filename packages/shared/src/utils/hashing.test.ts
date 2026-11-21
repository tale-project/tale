import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { computeContentHash } from './hashing.ts';

function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256')
    .update(
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : content,
    )
    .digest('hex');
}

describe('computeContentHash', () => {
  it('hashes empty bytes', () => {
    expect(computeContentHash(new Uint8Array())).toBe(
      sha256Hex(new Uint8Array()),
    );
  });

  it('hashes known content', () => {
    const content = Buffer.from('hello world');
    expect(computeContentHash(content)).toBe(sha256Hex(content));
  });

  it('is deterministic', () => {
    const content = Buffer.from('test data for dedup');
    expect(computeContentHash(content)).toBe(computeContentHash(content));
  });

  it('produces different hashes for different content', () => {
    expect(computeContentHash(Buffer.from('a'))).not.toBe(
      computeContentHash(Buffer.from('b')),
    );
  });

  it('encodes strings as UTF-8', () => {
    expect(computeContentHash('hello world')).toBe(sha256Hex('hello world'));
  });

  it.each([
    ['an empty string', ''],
    ['characters of every width', 'Zürich, 東京, 😀 and €.'],
    ['half a surrogate pair', `before ${'😀'.charAt(0)} after`],
    ['the other half', `before ${'😀'.charAt(1)} after`],
  ])('hashes %s as its UTF-8 encoding', (_what, text) => {
    expect(computeContentHash(text)).toBe(sha256Hex(text));
  });
});

// A long text is encoded a piece at a time, so that hashing it does not hold
// a second copy of it. The hash is a document's identity in the index: it
// must be the hash of the text encoded whole, to the byte.
describe('the hash of a long text', () => {
  /** Where the first piece of a long text ends. */
  const PIECE = 64 * 1024;
  const PAIR = '😀';
  const HIGH = PAIR.charAt(0);
  const LOW = PAIR.charAt(1);

  /** A text of `length` code units with `inserted` at `at`. */
  function longText(length: number, at: number, inserted: string): string {
    const filler = 'The quarterly figures follow. ';
    const whole = filler.repeat(Math.ceil(length / filler.length));
    return (
      whole.slice(0, at) + inserted + whole.slice(at + inserted.length, length)
    );
  }

  it.each([
    ['plain text', longText(3 * PIECE + 17, 0, '')],
    ['text of exactly one piece', longText(PIECE, 0, '')],
    ['text one unit longer than a piece', longText(PIECE + 1, 0, '')],
    ['text of exactly two pieces', longText(2 * PIECE, 0, '')],
    ['characters of two and three bytes', `é€${'ü„“ '.repeat(PIECE)}`],
  ])('is the hash of the text encoded whole, for %s', (_what, text) => {
    expect(computeContentHash(text)).toBe(sha256Hex(text));
  });

  it.each([
    ['ends just before it', PIECE - 2],
    ['straddles it', PIECE - 1],
    ['starts right after it', PIECE],
  ])(
    'keeps a surrogate pair whole where it %s the end of a piece',
    (_where, at) => {
      const text = longText(2 * PIECE + 9, at, PAIR);
      expect(text.slice(at, at + 2)).toBe(PAIR);
      expect(computeContentHash(text)).toBe(sha256Hex(text));
    },
  );

  it('keeps every pair whole in a text that is nothing but pairs, at either parity', () => {
    for (const lead of ['', 'x']) {
      const text = lead + PAIR.repeat(PIECE + 5);
      expect(computeContentHash(text)).toBe(sha256Hex(text));
    }
  });

  it.each([
    ['a high half with no low half after it', HIGH],
    ['a low half with no high half before it', LOW],
    ['two high halves', HIGH + HIGH],
    ['a low half then a high half', LOW + HIGH],
    ['a lone high half, then a pair', HIGH + PAIR],
  ])(
    'encodes %s at the end of a piece as the whole text does',
    (_what, odd) => {
      for (const at of [PIECE - 2, PIECE - 1, PIECE]) {
        const text = longText(2 * PIECE + 9, at, odd);
        expect(computeContentHash(text)).toBe(sha256Hex(text));
      }
    },
  );

  it('is the hash of the same text for random texts cut at random places', () => {
    let state = 4942;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const units = ['a', ' ', 'é', '€', PAIR, HIGH, LOW, '\n'];
    for (let round = 0; round < 12; round += 1) {
      // A run of mixed units around each piece's end, filler between.
      let text = '';
      while (text.length < 2 * PIECE + 100) {
        const untilEnd = PIECE - (text.length % PIECE);
        if (untilEnd > 40) {
          text += 'b'.repeat(untilEnd - 20 - Math.floor(next() * 10));
        } else {
          text += units[Math.floor(next() * units.length)] ?? 'a';
        }
      }
      expect(computeContentHash(text)).toBe(sha256Hex(text));
    }
  });
});
