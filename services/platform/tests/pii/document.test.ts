/**
 * `scrubDocument` — the whole-document scan over the chat-sized engine.
 *
 * The properties: every window stays under the engine clamp, the pieces
 * join back to the input exactly, a match past the clamp is found in every
 * mode, a rewritten document keeps its length, no window cut ever falls
 * inside an identifier the engine would detect, and a truncated window —
 * whatever verdict it came back with, a `pass` included — is rescanned in
 * halves rather than returned.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGE_BYTES,
  PatternRegistry,
  blocked,
  clampMessage,
  createScrubber,
  modified,
  normalizeForDetection,
  pass,
  scrubDocument,
  splitIntoWindows,
  type PiiPattern,
  type Scrubber,
} from '../../lib/pii';

const REGISTRY = PatternRegistry.fromDefaults();
const WINDOW_CHARS = Math.floor(MAX_MESSAGE_BYTES / 4);

const EMAIL = 'write to ada@example.com please';
const CARD = 'card 4111 1111 1111 1111 on file';
const FILLER = 'Refunds are honoured within thirty days of purchase.\n';
/**
 * A composition-excluded code point: NFC decomposes U+0958 into U+0915
 * U+093C (one code unit into two, three UTF-8 bytes into six), so a window
 * of them is cut under the clamp and then doubles past it inside the
 * engine, which clamps it and sees nothing of the tail.
 */
const NFC_GROWING_HEAD = String.fromCharCode(0x0958).repeat(12_000);

function longText(head: string, tail: string): string {
  return [head, FILLER.repeat(2_500), tail].join('\n');
}

function fakeScrubber(
  scrub: Scrubber['scrub'],
  patterns: PiiPattern[] = [],
): Scrubber {
  return { scrub, patterns, locales: [] };
}

/**
 * Identifiers placed so that the preferred cut — the last space in the
 * second half of the first window — falls inside them: the head is one
 * unbroken word, so the only separators in range are the identifier's own.
 * A single-line CSV export or minified text has exactly this shape.
 */
const STRADDLE_HEAD = 'a'.repeat(WINDOW_CHARS - 10);
const STRADDLE_CARD = `${STRADDLE_HEAD} 4111 1111 1111 1111 rest of the line`;
const STRADDLE_IBAN = `${STRADDLE_HEAD} DE89 3704 0044 0532 0130 00 rest`;
const STRADDLE_PHONE = `${STRADDLE_HEAD} +49 30 12345678 rest of the line`;
/**
 * No separator at all: the hard cut lands inside the address. The filler
 * is a character the email pattern's classes exclude — a letter head would
 * be swallowed into the local part and make the whole text one match.
 */
const STRADDLE_EMAIL = `${'#'.repeat(WINDOW_CHARS - 10)}ada.lovelace@example.com${'#'.repeat(50)}`;

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

  describe('with the patterns to keep whole', () => {
    const { patterns } = createScrubber({
      mode: 'mask',
      registry: REGISTRY,
      patterns: { email: true, creditCard: true, iban: true, phone: true },
    });

    it('cuts inside a spaced identifier when it has no patterns to check', () => {
      // The defect, pinned as the baseline the checked cut is measured
      // against: the space inside the card number is the preferred cut.
      const [first, second] = splitIntoWindows(STRADDLE_CARD, WINDOW_CHARS);
      expect(first?.endsWith(' 4111 ')).toBe(true);
      expect(second?.startsWith('1111 1111 1111 ')).toBe(true);
    });

    it.each([
      ['card number', STRADDLE_CARD, '4111 1111 1111 1111'],
      ['IBAN', STRADDLE_IBAN, 'DE89 3704 0044 0532 0130 00'],
      ['phone number', STRADDLE_PHONE, '+49 30 12345678'],
      ['email at a hard cut', STRADDLE_EMAIL, 'ada.lovelace@example.com'],
    ])('keeps a straddling %s whole in one window', (_, text, identifier) => {
      const windows = splitIntoWindows(text, WINDOW_CHARS, patterns);
      expect(windows.join('')).toBe(text);
      for (const w of windows) {
        expect(w.length).toBeLessThanOrEqual(WINDOW_CHARS);
      }
      expect(windows.filter((w) => w.includes(identifier))).toHaveLength(1);
    });

    it('moves the cut back to the separator before the identifier', () => {
      const [first, second] = splitIntoWindows(
        STRADDLE_CARD,
        WINDOW_CHARS,
        patterns,
      );
      expect(first).toBe(`${STRADDLE_HEAD} `);
      expect(second).toBe('4111 1111 1111 1111 rest of the line');
    });

    it('never ends a window inside a digit group of a dense single line', () => {
      // A CSV export without line breaks: every second-half separator sits
      // next to or inside an identifier, so cuts move on most windows.
      const row =
        'Ada Lovelace,4111 1111 1111 1111,DE89 3704 0044 0532 0130 00,+49 30 12345678,ada@example.com,';
      const text = row.repeat(Math.ceil((WINDOW_CHARS * 6) / row.length));
      const windows = splitIntoWindows(text, WINDOW_CHARS, patterns);
      expect(windows.length).toBeGreaterThan(5);
      expect(windows.join('')).toBe(text);
      for (const w of windows) {
        expect(w.length).toBeLessThanOrEqual(WINDOW_CHARS);
      }
      // Every identifier survives whole in some window: the windows hold
      // exactly as many copies as the text does.
      const count = (haystack: string, needle: string): number =>
        haystack.split(needle).length - 1;
      for (const identifier of [
        '4111 1111 1111 1111',
        'DE89 3704 0044 0532 0130 00',
        '+49 30 12345678',
      ]) {
        expect(windows.reduce((n, w) => n + count(w, identifier), 0)).toBe(
          count(text, identifier),
        );
      }
    });

    it('cuts an identifier longer than a window like any text, and ends', () => {
      // A JWT-shaped run longer than the window: the engine cannot see it
      // whole anywhere, so the split is unavoidable — the cut stands.
      const { patterns: jwt } = createScrubber({
        mode: 'mask',
        registry: REGISTRY,
        patterns: { jwt: true },
      });
      const token = `eyJ${'a'.repeat(WINDOW_CHARS)}.eyJ${'b'.repeat(40)}.sig`;
      const windows = splitIntoWindows(`head ${token} tail`, WINDOW_CHARS, jwt);
      expect(windows.join('')).toBe(`head ${token} tail`);
      expect(windows.length).toBeGreaterThan(1);
      for (const w of windows) {
        expect(w.length).toBeLessThanOrEqual(WINDOW_CHARS);
      }
    });
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

  describe('an identifier straddling the window cut', () => {
    const straddle = createScrubber({
      mode: 'block',
      registry: REGISTRY,
      patterns: { email: true, creditCard: true, iban: true, phone: true },
    });
    const straddleMask = createScrubber({
      mode: 'mask',
      registry: REGISTRY,
      patterns: { email: true, creditCard: true, iban: true, phone: true },
    });

    it.each([
      ['card number', STRADDLE_CARD, 'creditCard', '4111 1111 1111 1111'],
      ['IBAN', STRADDLE_IBAN, 'iban', 'DE89 3704 0044 0532 0130 00'],
      ['phone number', STRADDLE_PHONE, 'phone', '+49 30 12345678'],
      [
        'email at a hard cut',
        STRADDLE_EMAIL,
        'email',
        'ada.lovelace@example.com',
      ],
    ])('is blocked and masked: %s', (_, text, category, identifier) => {
      // The engine sees the identifier in a message; the document scan
      // must not lose it to the cut.
      expect(straddle.scrub(`x ${identifier} y`).kind).toBe('blocked');
      expect(scrubDocument(straddle, text)).toEqual(blocked([category], 1));

      const o = scrubDocument(straddleMask, text);
      expect(o.kind).toBe('modified');
      if (o.kind !== 'modified') return;
      expect(o.text).not.toContain(identifier);
      expect(o.categoryIds).toEqual([category]);
      expect(o.matchCount).toBe(1);
      // Neither half of the identifier survives raw around the token.
      expect(o.text).toMatch(/a \[(CREDIT_CARD|IBAN|PHONE)\] rest|#\[EMAIL\]#/);
    });
  });

  it('normalizes once, so a window is never clamped inside the engine', () => {
    // The NFC-growing head is normalized before it is windowed: it arrives
    // at the engine already grown and cut under the clamp, so every window
    // is scanned exactly once — no truncated verdict, no halving.
    const calls: number[] = [];
    const counting: Scrubber = {
      ...block,
      scrub: (piece) => {
        const outcome = block.scrub(piece);
        calls.push(piece.length);
        expect(outcome.kind === 'step_error' || !outcome.truncated).toBe(true);
        return outcome;
      },
    };
    const text = `${NFC_GROWING_HEAD} ${CARD}`;
    expect(scrubDocument(counting, text)).toEqual(blocked(['creditCard'], 1));
    const normalizedLength = normalizeForDetection(text).length;
    expect(normalizedLength).toBeGreaterThan(WINDOW_CHARS);
    expect(calls).toHaveLength(Math.ceil(normalizedLength / WINDOW_CHARS));
  });

  it('blocks an identifier behind a head that doubles under NFC', () => {
    const text = `${NFC_GROWING_HEAD} ${CARD}`;
    // One window as cut, clamped inside the engine after normalization; a
    // message-sized scrub sees only the clean head and passes.
    expect(text.length).toBeLessThanOrEqual(WINDOW_CHARS);
    expect(clampMessage(normalizeForDetection(text)).truncated).toBe(true);
    expect(block.scrub(text)).toEqual(pass(true));
    expect(scrubDocument(block, text)).toEqual(blocked(['creditCard'], 1));
  });

  it('masks an identifier behind a head that doubles under NFC', () => {
    const o = scrubDocument(mask, `${NFC_GROWING_HEAD} ${CARD}`);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[CREDIT_CARD]');
    expect(o.text).not.toContain('4111 1111 1111 1111');
    expect(o.truncated).toBeUndefined();
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

  it('treats a truncated pass as unscanned and rescans it in halves', () => {
    // The clamped prefix matched nothing; the identifier sits in the tail
    // the engine never looked at. A bare pass here would index it.
    const seen: string[] = [];
    const scrubber = fakeScrubber((text) => {
      if (text.length >= 8) return pass(true);
      seen.push(text);
      return text.includes('!') ? blocked(['x'], 1) : pass();
    });
    const o = scrubDocument(scrubber, 'abcdefgh ijkl!mnop qrstuvwx', {
      windowBytes: 4 * 20,
    });
    expect(o).toEqual(blocked(['x'], 1));
    expect(seen.join('')).toBe('abcdefgh ijkl!mnop qrstuvwx');
  });

  it('halves a truncated window without cutting inside an identifier', () => {
    // The engine's flag, forced on anything 16 units or longer. The
    // midpoint cut would fall on the space inside `1234 5678`; the checked
    // cut moves it back to the space before the identifier.
    const spaced: PiiPattern = {
      name: 'x',
      regex: /\d{4} \d{4}/g,
      replacement: '[X]',
    };
    const seen: string[] = [];
    const scrubber = fakeScrubber(
      (text) => {
        if (text.length >= 16) return pass(true);
        seen.push(text);
        return /\d{4} \d{4}/.test(text)
          ? modified(text.replace(/\d{4} \d{4}/, '[X]'), ['x'], 1)
          : pass();
      },
      [spaced],
    );
    const text = 'abcdefghij 1234 5678 klmnopqrstuv';
    const o = scrubDocument(scrubber, text, { windowBytes: 4 * 40 });
    expect(seen).toEqual(['abcdefghij ', '1234 5678 ', 'klmnopqrstuv']);
    expect(o).toEqual(modified('abcdefghij [X] klmnopqrstuv', ['x'], 1));
  });

  it('surfaces a step error instead of indexing an unscanned window', () => {
    const scrubber = fakeScrubber(() => modified('', [], 0, true));
    const o = scrubDocument(scrubber, 'abcd', { windowBytes: 16 });
    expect(o.kind).toBe('step_error');
  });

  it('lets a step error outrank a modified window elsewhere', () => {
    // Deliberate: a partially masked text would present the unscanned
    // window as scanned. The caller decides fail-open or fail-closed on its
    // own original text.
    let calls = 0;
    const scrubber = fakeScrubber(() => {
      calls += 1;
      return calls === 1
        ? modified('[X]', ['x'], 1)
        : { kind: 'step_error', filterName: 'pii', reason: 'forced' };
    });
    const o = scrubDocument(scrubber, 'one two', { windowBytes: 16 });
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
