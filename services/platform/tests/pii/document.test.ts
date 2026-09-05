/**
 * `scrubDocument` — the whole-document scan over the chat-sized engine.
 *
 * The properties: every window stays under the engine clamp, the pieces
 * join back to the input exactly, a match past the clamp is found in every
 * mode, a rewritten document keeps its length, and a truncated window is
 * rescanned in halves rather than returned.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGE_BYTES,
  PatternRegistry,
  blocked,
  createScrubber,
  modified,
  pass,
  scrubDocument,
  splitIntoWindows,
  type Scrubber,
} from '../../lib/pii';

const REGISTRY = PatternRegistry.fromDefaults();
const WINDOW_CHARS = Math.floor(MAX_MESSAGE_BYTES / 4);

const EMAIL = 'write to ada@example.com please';
const CARD = 'card 4111 1111 1111 1111 on file';
const FILLER = 'Refunds are honoured within thirty days of purchase.\n';

function longText(head: string, tail: string): string {
  return [head, FILLER.repeat(2_500), tail].join('\n');
}

function fakeScrubber(scrub: Scrubber['scrub']): Scrubber {
  return { scrub, patterns: [], locales: [] };
}

describe('splitIntoWindows', () => {
  it('keeps every window under the size and joins back to the input', () => {
    const text = longText(EMAIL, CARD);
    const windows = splitIntoWindows(text, WINDOW_CHARS);
    expect(windows.length).toBeGreaterThan(1);
    for (const w of windows) expect(w.length).toBeLessThanOrEqual(WINDOW_CHARS);
    expect(windows.join('')).toBe(text);
  });

  it('cuts after a line break when one is available', () => {
    const text = longText(EMAIL, CARD);
    const windows = splitIntoWindows(text, WINDOW_CHARS);
    for (const w of windows.slice(0, -1)) expect(w.endsWith('\n')).toBe(true);
  });

  it('prefers a paragraph break over a line break', () => {
    // Both breaks sit in the searched second half of an 80-unit window; the
    // later line break loses to the earlier paragraph break.
    const paragraph =
      'a'.repeat(45) + '\n\n' + 'b'.repeat(10) + '\n' + 'c'.repeat(30);
    expect(splitIntoWindows(paragraph, 80)[0]).toBe('a'.repeat(45) + '\n\n');
  });

  it('never splits a surrogate pair on a hard cut', () => {
    const emoji = '😀'.repeat(40);
    for (const w of splitIntoWindows(emoji, 11)) {
      expect(w.isWellFormed()).toBe(true);
    }
  });

  it('returns one window for a short text', () => {
    expect(splitIntoWindows('short', WINDOW_CHARS)).toEqual(['short']);
  });
});

describe('scrubDocument over the engine', () => {
  const mask = createScrubber({
    mode: 'mask',
    registry: REGISTRY,
    patterns: { email: true, creditCard: true },
  });
  const block = createScrubber({
    mode: 'block',
    registry: REGISTRY,
    patterns: { email: true, creditCard: true },
  });

  it('masks identifiers at both ends of a document past the clamp', () => {
    const text = longText(EMAIL, CARD);
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(
      MAX_MESSAGE_BYTES * 2,
    );
    const o = scrubDocument(mask, text);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[EMAIL]');
    expect(o.text).toContain('[CREDIT_CARD]');
    expect(o.text).not.toContain('4111 1111 1111 1111');
    expect(o.text.length).toBeGreaterThan(text.length - 60);
    expect(o.categoryIds).toEqual(['email', 'creditCard']);
    expect(o.matchCount).toBe(2);
    expect(o.truncated).toBeUndefined();
  });

  it('blocks on an identifier that sits only past the clamp', () => {
    const o = scrubDocument(block, longText('clean head', CARD));
    expect(o).toEqual(blocked(['creditCard'], 1));
  });

  it('passes a clean document past the clamp', () => {
    expect(scrubDocument(mask, longText('clean', 'also clean'))).toEqual(
      pass(),
    );
  });

  it('agrees with scrub on a message-sized input', () => {
    const short = `${EMAIL} and ${CARD}`;
    expect(scrubDocument(mask, short)).toEqual(mask.scrub(short));
  });

  it('passes an empty document', () => {
    expect(scrubDocument(mask, '')).toEqual(pass());
  });
});

describe('scrubDocument aggregation', () => {
  it('rescans a truncated window in halves instead of returning it', () => {
    // A scrubber that only copes with pieces under 8 units and reports
    // anything longer as truncated — the engine's flag, forced.
    const seen: string[] = [];
    const scrubber = fakeScrubber((text) => {
      if (text.length >= 8) return modified(text.slice(0, 8), ['x'], 1, true);
      seen.push(text);
      return text.includes('!')
        ? modified(text.replace('!', '#'), ['x'], 1)
        : pass();
    });
    const o = scrubDocument(scrubber, 'abcdefgh ijkl!mnop qrstuvwx', {
      windowBytes: 4 * 20,
    });
    expect(o).toEqual(modified('abcdefgh ijkl#mnop qrstuvwx', ['x'], 1));
    expect(seen.join('')).toBe('abcdefgh ijkl!mnop qrstuvwx');
  });

  it('surfaces a step error instead of indexing an unscanned window', () => {
    const scrubber = fakeScrubber(() => modified('', [], 0, true));
    const o = scrubDocument(scrubber, 'abcd', { windowBytes: 16 });
    expect(o.kind).toBe('step_error');
  });

  it('lets a blocked window outrank a step error elsewhere', () => {
    let calls = 0;
    const scrubber = fakeScrubber(() => {
      calls += 1;
      return calls === 1
        ? { kind: 'step_error', filterName: 'pii', reason: 'forced' }
        : blocked(['email'], 1);
    });
    const o = scrubDocument(scrubber, 'one two', { windowBytes: 16 });
    expect(o).toEqual(blocked(['email'], 1));
  });
});
