/**
 * Wide-char-aware visible width and truncation — the single most correctness-
 * critical primitive in the terminal core. A cursor-up live region desyncs
 * permanently if a line's measured width disagrees with what the terminal
 * actually printed, so this counts East-Asian width correctly: combining marks
 * are zero-width, CJK / fullwidth / emoji are double-width, ANSI escapes are
 * invisible.
 *
 * node-free: reuses {@link stripAnsi} / {@link matchAnsiAt} from `./ansi`.
 */

import { matchAnsiAt, RESET, stripAnsi } from './ansi';

/**
 * Visible width of one Unicode code point. Counting wide chars as 1 (the naive
 * `.length`) is what makes a cursor-up region drift on non-Latin content.
 */
function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0x200b && cp <= 0x200f) || // zero-width spaces / marks (incl. ZWJ/ZWNJ)
    cp === 0xfeff // zero-width no-break space
  ) {
    return 0;
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals … Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe10 && cp <= 0xfe19) || // vertical forms
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK compatibility / small forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Extension B+
  ) {
    return 2;
  }
  return 1;
}

/** Visible (printed) width of a string, ANSI- and wide-char-aware. */
export function visibleWidth(value: string): number {
  const stripped = stripAnsi(value);
  let width = 0;
  for (const ch of stripped) {
    width += charWidth(ch.codePointAt(0) ?? 0);
  }
  return width;
}

/**
 * Truncate `line` to at most `maxWidth` visible columns, preserving (never
 * splitting) ANSI escapes. If the input carried any color a single reset is
 * appended so a cut mid-color can't bleed into following output — but ONLY then,
 * so escape-free input (piped / NO_COLOR) stays byte-for-byte escape-free, and at
 * most one reset is ever added (never two, even if the source already ended in
 * one we cut past).
 */
export function truncate(line: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(line) <= maxWidth) return line;

  let out = '';
  let width = 0;
  let sawEscape = false;
  let i = 0;
  while (i < line.length) {
    const esc = matchAnsiAt(line, i);
    if (esc !== null) {
      out += esc;
      sawEscape = true;
      i += esc.length;
      continue;
    }
    const cp = line.codePointAt(i) ?? 0;
    const w = charWidth(cp);
    if (width + w > maxWidth) break;
    width += w;
    out += String.fromCodePoint(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return sawEscape ? `${out}${RESET}` : out;
}
