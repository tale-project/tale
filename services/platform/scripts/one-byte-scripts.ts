/**
 * Write a built script so that V8 can hold it as a one-byte string.
 *
 * V8 keeps the source text of every script it loads. A text whose characters
 * all fit in a byte (up to U+00FF) is kept one byte a character; a single
 * character above that — an em dash in a message, an arrow in a template —
 * makes V8 keep the WHOLE script two bytes a character. The built backend is
 * a dozen megabytes of script and nearly every file had such a character, so
 * its code cost twice its size in memory (tale-project/tale#4942, finding 2;
 * 13 MiB of a 105 MiB process, measured).
 *
 * A JavaScript source can spell any character as `\uXXXX` wherever it may
 * appear: in a string, a template, a regular expression, an identifier. So
 * each UTF-16 unit above U+00FF is rewritten as its escape, which changes the
 * bytes of the file and nothing a program can observe. (The one place a
 * program could tell — the raw text of a tagged template — is spelled by the
 * author, and an author who wants the raw backslash writes it.)
 *
 * The escapes are longer than what they replace, so every position after one
 * on the same line moves; `shiftGeneratedColumns` moves the script's source
 * map along, and `verifyShift` proves on every mapped position that it did.
 */

/** The highest UTF-16 unit a one-byte string holds. */
const ONE_BYTE_MAX = 0xff;
const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;

/** How far the text after `column` moved, on one line of a script. */
export type ColumnShift = readonly [column: number, delta: number];

export interface OneByteScript {
  /** The script with every unit above U+00FF written as `\uXXXX`. */
  text: string;
  /** For each line, where an escape was written and by how much it moved
   * what follows, in ascending column order; empty for a line without one. */
  shifts: ColumnShift[][];
  /** How many units were escaped. */
  escaped: number;
}

function unicodeEscape(unit: number): string {
  return `\\u${unit.toString(16).padStart(4, '0')}`;
}

function escapeLine(line: string, lineNumber: number): [string, ColumnShift[]] {
  let out = '';
  let last = 0;
  const shifts: ColumnShift[] = [];
  for (let index = 0; index < line.length; index += 1) {
    const unit = line.charCodeAt(index);
    if (unit <= ONE_BYTE_MAX) continue;
    let backslashes = 0;
    while (
      index - backslashes - 1 >= last &&
      line[index - backslashes - 1] === '\\'
    )
      backslashes += 1;
    if (backslashes % 2 === 0) {
      out += line.slice(last, index) + unicodeEscape(unit);
      shifts.push([index, 5]);
    } else {
      // `\—`, an identity escape: the backslash that escaped the character
      // becomes the backslash of its escape. A backslash before a line
      // separator is something else, a line continuation, which stands for
      // nothing at all; no printer writes one, and it is refused here rather
      // than turned into the character.
      if (unit === LINE_SEPARATOR || unit === PARAGRAPH_SEPARATOR)
        throw new Error(
          `line ${lineNumber + 1}, column ${index}: a line continuation before U+${unit.toString(16).toUpperCase()} cannot be written as an escape`,
        );
      out += line.slice(last, index - 1) + unicodeEscape(unit);
      shifts.push([index - 1, 5], [index, -1]);
    }
    last = index + 1;
  }
  return [out + line.slice(last), shifts];
}

/** The script with every UTF-16 unit above U+00FF escaped, and the record of
 * what moved where. */
export function toOneByteScript(text: string): OneByteScript {
  const shifts: ColumnShift[][] = [];
  let escaped = 0;
  const lines = text.split('\n').map((line, lineNumber) => {
    const [out, lineShifts] = escapeLine(line, lineNumber);
    shifts.push(lineShifts);
    for (const [, delta] of lineShifts) if (delta > 0) escaped += 1;
    return out;
  });
  return { text: lines.join('\n'), shifts, escaped };
}

/**
 * Where a column of an original line is in the escaped one. The positions of
 * a source map come in ascending order within a line, so the cursor walks the
 * line's shifts once; a column behind the last one asked starts over.
 */
class ShiftCursor {
  private next = 0;
  private moved = 0;
  private last = 0;
  private readonly shifts: readonly ColumnShift[];

  constructor(shifts: readonly ColumnShift[]) {
    this.shifts = shifts;
  }

  at(column: number): number {
    if (column < this.last) {
      this.next = 0;
      this.moved = 0;
    }
    this.last = column;
    for (; this.next < this.shifts.length; this.next += 1) {
      const shift = this.shifts[this.next];
      if (shift === undefined || shift[0] >= column) break;
      this.moved += shift[1];
    }
    return column + this.moved;
  }
}

/** Where `column` of the original line is in the escaped one. */
export function shiftedColumn(
  column: number,
  shifts: readonly ColumnShift[],
): number {
  return new ShiftCursor(shifts).at(column);
}

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map(
  Array.from({ length: BASE64.length }, (_, value) => [
    BASE64.charAt(value),
    value,
  ]),
);

/** The first base64-VLQ field of a mapping segment, and how many characters
 * it takes. */
function firstField(segment: string): { value: number; length: number } {
  let result = 0;
  let scale = 1;
  for (let index = 0; index < segment.length; index += 1) {
    const digit = DIGIT.get(segment.charAt(index));
    if (digit === undefined) break;
    result += (digit % 32) * scale;
    scale *= 32;
    if (digit < 32) {
      const magnitude = Math.floor(result / 2);
      return {
        value: result % 2 === 1 ? -magnitude : magnitude,
        length: index + 1,
      };
    }
  }
  throw new Error(`not a base64 VLQ field: ${segment.slice(0, 12)}`);
}

function vlq(value: number): string {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let out = '';
  do {
    const digit = rest % 32;
    rest = Math.floor(rest / 32);
    out += BASE64.charAt(rest > 0 ? digit + 32 : digit);
  } while (rest > 0);
  return out;
}

/** One mapped position of a source map: a generated line and column. */
export interface GeneratedPosition {
  line: number;
  column: number;
}

/**
 * A source map's `mappings` with every generated column moved by what the
 * escapes of its line added before it. Only a segment's first field is its
 * generated column, counted from the segment before it on the same line; the
 * fields that name the source position are carried over untouched.
 * `positions`, when given, collects each position before it was moved.
 */
export function shiftGeneratedColumns(
  mappings: string,
  shifts: readonly (readonly ColumnShift[])[],
  positions?: GeneratedPosition[],
): string {
  return mappings
    .split(';')
    .map((line, lineNumber) => {
      if (line === '') return line;
      const cursor = new ShiftCursor(shifts[lineNumber] ?? []);
      let column = 0;
      let movedBefore = 0;
      return line
        .split(',')
        .map((segment) => {
          const { value, length } = firstField(segment);
          column += value;
          positions?.push({ line: lineNumber, column });
          const moved = cursor.at(column);
          const field = vlq(moved - movedBefore);
          movedBefore = moved;
          return field + segment.slice(length);
        })
        .join(',');
    })
    .join(';');
}

/**
 * Proof that the columns moved with the text: at every mapped position, the
 * escaped script holds the character the original held there, or the escape
 * that replaced it. Throws at the first position that does not line up.
 */
export function verifyShift(
  original: string,
  script: OneByteScript,
  positions: readonly GeneratedPosition[],
): void {
  const before = original.split('\n');
  const after = script.text.split('\n');
  let lineNumber = -1;
  let cursor = new ShiftCursor([]);
  // What an escape wrote at each column of the current line: +5 where one
  // starts, -1 where a character was absorbed into the escape before it.
  let written = new Map<number, number>();
  for (const { line, column } of positions) {
    if (line !== lineNumber) {
      lineNumber = line;
      const shifts = script.shifts[line] ?? [];
      cursor = new ShiftCursor(shifts);
      written = new Map(shifts);
    }
    const source = before[line] ?? '';
    if (column >= source.length) continue;
    const moved = cursor.at(column);
    const delta = written.get(column);
    // A character an identity escape absorbed has no text of its own left:
    // its position points just past the escape.
    if (delta !== undefined && delta < 0) continue;
    const unit = source.charCodeAt(column);
    // Where an escape starts (on the wide character, or on the backslash that
    // escaped it) the script reads the escape; anywhere else, the character
    // it always had.
    let expected = source.charAt(column);
    if (delta !== undefined)
      expected = unit > ONE_BYTE_MAX ? unicodeEscape(unit) : '\\u';
    const target = after[line] ?? '';
    if (target.startsWith(expected, moved)) continue;
    throw new Error(
      `line ${line + 1}: column ${column} moved to ${moved}, where the escaped script reads ${JSON.stringify(target.slice(moved, moved + 8))} and not ${JSON.stringify(expected)}`,
    );
  }
}
