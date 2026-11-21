// @vitest-environment node

import { SourceMap } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  shiftedColumn,
  shiftGeneratedColumns,
  toOneByteScript,
  verifyShift,
  type GeneratedPosition,
} from './one-byte-scripts';

/**
 * Every character these cases are about is built from its code point, so the
 * file itself says exactly which characters a script holds and which escape
 * is expected, whatever an editor or a formatter does to it.
 */
const BACKSLASH = String.fromCodePoint(0x5c);
const E_ACUTE = String.fromCodePoint(0xe9); // Latin-1: fits a byte
const Y_DIAERESIS = String.fromCodePoint(0xff); // the last one that fits
const DASH = String.fromCodePoint(0x2014);
const ARROW = String.fromCodePoint(0x2192);
const ELLIPSIS = String.fromCodePoint(0x2026);
const OMEGA = String.fromCodePoint(0x3a9);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const GRINNING_FACE = String.fromCodePoint(0x1f600); // two UTF-16 units

/** The escape of one UTF-16 unit, as the module writes it. */
function escapeOf(unit: string): string {
  return `${BACKSLASH}u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/** An independent base64-VLQ encoder, so the cases do not check the module
 * against itself. */
const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encode(value: number): string {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let out = '';
  do {
    const digit = rest % 32;
    rest = Math.floor(rest / 32);
    out += BASE64.charAt(rest > 0 ? digit + 32 : digit);
  } while (rest > 0);
  return out;
}

/** Mappings for segments given as [generatedColumn, sourceLine, sourceColumn]
 * per generated line, all in source 0. */
function mappingsOf(lines: [number, number, number][][]): string {
  let sourceLine = 0;
  let sourceColumn = 0;
  return lines
    .map((segments) => {
      let column = 0;
      return segments
        .map(([generated, line, sourceCol]) => {
          const segment =
            encode(generated - column) +
            encode(0) +
            encode(line - sourceLine) +
            encode(sourceCol - sourceColumn);
          column = generated;
          sourceLine = line;
          sourceColumn = sourceCol;
          return segment;
        })
        .join(',');
    })
    .join(';');
}

/** A source map of one source file with the given mappings. */
function payloadOf(mappings: string, source = 'a.ts') {
  return {
    version: 3,
    file: 'built.js',
    sourceRoot: '',
    sources: [source],
    sourcesContent: [''],
    names: [],
    mappings,
  };
}

function hasWideUnit(text: string): boolean {
  for (let index = 0; index < text.length; index += 1)
    if (text.charCodeAt(index) > 0xff) return true;
  return false;
}

/** Both spellings are one program: run each and return its value. */
function run(script: string): unknown {
  // oxlint-disable-next-line no-eval -- the cases compare what the two spellings evaluate to
  return (0, eval)(script);
}

describe('writing a script as one-byte characters', () => {
  it('spells every character above U+00FF as its escape and leaves Latin-1 alone', () => {
    const script = toOneByteScript(
      `const a="${E_ACUTE}${Y_DIAERESIS} ${DASH} ${ARROW}";`,
    );
    expect(script.text).toBe(
      `const a="${E_ACUTE}${Y_DIAERESIS} ${escapeOf(DASH)} ${escapeOf(ARROW)}";`,
    );
    expect(script.escaped).toBe(2);
    expect(hasWideUnit(script.text)).toBe(false);
  });

  it('evaluates to the same value in a string, a template, a regular expression and an identifier', () => {
    const source = [
      `var s = "na${E_ACUTE}ve ${DASH} ok";`,
      `var t = \`${ARROW} \${s} ${ARROW}\`;`,
      `var r = /${DASH}+${ELLIPSIS}/.test("${DASH}${DASH}${ELLIPSIS}");`,
      `var ${OMEGA}mega = 2;`,
      `var face = "${GRINNING_FACE}";`,
      `({ s, t, r, sum: ${OMEGA}mega + 1, face, units: face.length })`,
    ].join('\n');
    const script = toOneByteScript(source);
    expect(hasWideUnit(source)).toBe(true);
    expect(hasWideUnit(script.text)).toBe(false);
    expect(run(script.text)).toEqual(run(source));
    expect(run(script.text)).toMatchObject({
      r: true,
      sum: 3,
      face: GRINNING_FACE,
      units: 2,
    });
  });

  it('writes each half of a character outside the basic plane as its own escape', () => {
    const script = toOneByteScript(`"${GRINNING_FACE}"`);
    expect(script.text).toBe(
      `"${escapeOf(GRINNING_FACE.charAt(0))}${escapeOf(GRINNING_FACE.charAt(1))}"`,
    );
    expect(script.escaped).toBe(2);
    expect(run(script.text)).toBe(GRINNING_FACE);
  });

  it('turns an identity escape into the escape itself instead of doubling the backslash', () => {
    // "\—" and /\—/: a backslash before the character, which stands for it.
    const source = `var s = "${BACKSLASH}${DASH}"; var r = /${BACKSLASH}${DASH}/.test("${DASH}"); [s, r]`;
    const script = toOneByteScript(source);
    expect(script.text).toBe(
      `var s = "${escapeOf(DASH)}"; var r = /${escapeOf(DASH)}/.test("${escapeOf(DASH)}"); [s, r]`,
    );
    expect(run(script.text)).toEqual([DASH, true]);
    expect(run(script.text)).toEqual(run(source));
  });

  it('escapes a character after an escaped backslash as itself', () => {
    // "\\—": a backslash, then the character.
    const source = `var s = "${BACKSLASH}${BACKSLASH}${DASH}"; s`;
    const script = toOneByteScript(source);
    expect(script.text).toBe(
      `var s = "${BACKSLASH}${BACKSLASH}${escapeOf(DASH)}"; s`,
    );
    expect(run(script.text)).toBe(`${BACKSLASH}${DASH}`);
    expect(run(script.text)).toBe(run(source));
  });

  it('writes a line separator inside a string as its escape', () => {
    const source = `var s = "a${LINE_SEPARATOR}b"; s`;
    const script = toOneByteScript(source);
    expect(script.text).toBe(`var s = "a${escapeOf(LINE_SEPARATOR)}b"; s`);
    expect(run(script.text)).toBe(`a${LINE_SEPARATOR}b`);
  });

  it('refuses a line continuation before a line separator, which no escape can spell', () => {
    expect(() =>
      toOneByteScript(`var s = "a${BACKSLASH}${LINE_SEPARATOR}b";`),
    ).toThrow(/line 1, column 11: a line continuation before U\+2028/);
  });

  it('leaves a script without such a character byte for byte', () => {
    const source = `export const a = "plain ${E_ACUTE} ${Y_DIAERESIS}";\n`;
    const script = toOneByteScript(source);
    expect(script.text).toBe(source);
    expect(script.escaped).toBe(0);
    expect(script.shifts.every((line) => line.length === 0)).toBe(true);
  });
});

describe('where a column moves to', () => {
  it('stays put up to the first escape and moves five places per escape behind it', () => {
    // columns:                          0 1 2       3 4 5        6 7
    const { text, shifts } = toOneByteScript(`ab${DASH}cd${ARROW}ef`);
    const line = shifts[0] ?? [];
    expect(shiftedColumn(0, line)).toBe(0);
    expect(shiftedColumn(2, line)).toBe(2); // on the dash: where its escape starts
    expect(shiftedColumn(3, line)).toBe(8);
    expect(text.charAt(8)).toBe('c');
    expect(shiftedColumn(5, line)).toBe(10); // on the arrow
    expect(shiftedColumn(6, line)).toBe(16);
    expect(text.charAt(16)).toBe('e');
  });

  it('moves four places past an identity escape, whose backslash is reused', () => {
    const { text, shifts } = toOneByteScript(`a${BACKSLASH}${DASH}b`);
    expect(text).toBe(`a${escapeOf(DASH)}b`);
    const line = shifts[0] ?? [];
    expect(shiftedColumn(1, line)).toBe(1); // the backslash: where the escape starts
    expect(shiftedColumn(3, line)).toBe(7);
    expect(text.charAt(7)).toBe('b');
  });

  it('counts each line on its own', () => {
    const { shifts } = toOneByteScript(`${DASH}a\nbc\n${ARROW}${ARROW}d`);
    expect(shiftedColumn(1, shifts[0] ?? [])).toBe(6);
    expect(shiftedColumn(1, shifts[1] ?? [])).toBe(1);
    expect(shiftedColumn(2, shifts[2] ?? [])).toBe(12);
  });
});

describe('moving a source map along with its script', () => {
  // Two lines of a built script; each statement maps to a line of a source.
  //   line 0: const a="—";const b="→";      statements at columns 0 and 12
  //   line 1: const c="plain";const d="…";  statements at columns 0 and 16
  const original = [
    `const a="${DASH}";const b="${ARROW}";`,
    `const c="plain";const d="${ELLIPSIS}";`,
  ].join('\n');
  const segments: [number, number, number][][] = [
    [
      [0, 0, 0],
      [8, 0, 10],
      [12, 1, 0],
      [20, 1, 10],
    ],
    [
      [0, 2, 0],
      [16, 3, 0],
      [24, 3, 10],
    ],
  ];
  const map = payloadOf(mappingsOf(segments), '../backend/example.ts');

  it('keeps every mapped position on the text it was on', () => {
    const script = toOneByteScript(original);
    const positions: GeneratedPosition[] = [];
    const moved = {
      ...map,
      mappings: shiftGeneratedColumns(map.mappings, script.shifts, positions),
    };
    expect(positions).toEqual(
      segments.flatMap((line, lineNumber) =>
        line.map(([column]) => ({ line: lineNumber, column })),
      ),
    );
    const before = new SourceMap(map);
    const after = new SourceMap(moved);
    const beforeLines = original.split('\n');
    const afterLines = script.text.split('\n');
    for (const { line, column } of positions) {
      const newColumn = shiftedColumn(column, script.shifts[line] ?? []);
      const was = before.findEntry(line, column);
      const is = after.findEntry(line, newColumn);
      expect(is).toMatchObject({
        originalLine: 'originalLine' in was ? was.originalLine : -1,
        originalColumn: 'originalColumn' in was ? was.originalColumn : -1,
      });
      // And the text there is the text that was there.
      expect(afterLines[line]?.charAt(newColumn)).toBe(
        beforeLines[line]?.charAt(column),
      );
    }
    // The second statement of the first line moved by the first escape: from
    // column 12 to 17, and it still maps to source line 1.
    expect(script.text.split('\n')[0]?.slice(17, 24)).toBe('const b');
    expect(after.findEntry(0, 17)).toMatchObject({ originalLine: 1 });
    expect(() => verifyShift(original, script, positions)).not.toThrow();
  });

  it('leaves the mappings of a script without escapes as they were', () => {
    const script = toOneByteScript('const a=1;const b=2;');
    const mappings = mappingsOf([
      [
        [0, 0, 0],
        [10, 1, 0],
      ],
    ]);
    expect(shiftGeneratedColumns(mappings, script.shifts)).toBe(mappings);
  });

  it('keeps the empty lines of the mappings, which stand for lines nothing maps to', () => {
    const script = toOneByteScript(`a\n\n${DASH}b`);
    const mappings = `${encode(0)}${encode(0)}${encode(0)}${encode(0)};;${encode(1)}${encode(0)}${encode(2)}${encode(0)}`;
    const moved = shiftGeneratedColumns(mappings, script.shifts);
    expect(moved.split(';')).toHaveLength(3);
    expect(moved.split(';')[1]).toBe('');
    expect(new SourceMap(payloadOf(moved)).findEntry(2, 6)).toMatchObject({
      originalLine: 2,
    });
  });

  it('catches mappings that were not moved with the text', () => {
    const script = toOneByteScript(original);
    const positions: GeneratedPosition[] = [];
    shiftGeneratedColumns(map.mappings, script.shifts, positions);
    // A script that lost a character the map still counts.
    const drifted = {
      ...script,
      text: script.text.replace('const a', 'cons a'),
    };
    expect(() => verifyShift(original, drifted, positions)).toThrow(
      /line 1: column 8 moved to 8, where the escaped script reads/,
    );
  });

  it('reads multi-digit fields: a column far along a long line', () => {
    const long = `${'x'.repeat(5000)}${DASH}${'y'.repeat(5000)}z`;
    const script = toOneByteScript(long);
    const positions: GeneratedPosition[] = [];
    const mappings = mappingsOf([
      [
        [0, 0, 0],
        [5000, 0, 5000],
        [10001, 0, 10001],
      ],
    ]);
    const moved = new SourceMap(
      payloadOf(shiftGeneratedColumns(mappings, script.shifts, positions)),
    );
    expect(positions.map((position) => position.column)).toEqual([
      0, 5000, 10001,
    ]);
    expect(script.text.charAt(10006)).toBe('z');
    expect(moved.findEntry(0, 10006)).toMatchObject({ originalColumn: 10001 });
  });
});
