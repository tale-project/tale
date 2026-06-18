/**
 * The universally-safe ANSI vocabulary: cursor/erase escapes, the color palette,
 * the status markers, and ANSI stripping/matching helpers.
 *
 * Only the cross-terminal-safe escape set lives here: cursor-up, clear-line,
 * carriage-return, hide/show cursor, and SGR color. Alt-screen-class ops —
 * full-screen clear (`\x1b[2J`) and absolute cursor positioning (`\x1b[r;cH`) —
 * are deliberately ABSENT because they are not portable across terminals; a
 * regression test asserts they never reach the stream.
 *
 * The wide-char width algorithm (`visibleWidth`/`truncate`) lives in its sibling
 * `./width`, which reuses {@link stripAnsi} and {@link matchAnsiAt} from here.
 *
 * node-free: pure string builders, no `node:*` import.
 */

const E = '\x1b[';

/** Safe cursor/erase escapes. Empty `up(0)` so callers needn't guard. */
export const ESC = {
  /** Move the cursor up N physical rows (relative — never absolute). */
  up: (n: number): string => (n > 0 ? `${E}${n}A` : ''),
  /** Erase the entire current line. `2K` is the most portable line-erase. */
  clearLine: `${E}2K`,
  /** Column 0 of the current row (no escape — the safest sequence of all). */
  cursorStart: '\r',
  hideCursor: `${E}?25l`,
  showCursor: `${E}?25h`,
} as const;

export interface Palette {
  reset: string;
  bold: string;
  dim: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  cyan: string;
}

const COLOR_CODES: Palette = {
  reset: `${E}0m`,
  bold: `${E}1m`,
  dim: `${E}2m`,
  red: `${E}31m`,
  green: `${E}32m`,
  yellow: `${E}33m`,
  blue: `${E}34m`,
  cyan: `${E}36m`,
};

const NO_COLOR_PALETTE: Palette = {
  reset: '',
  bold: '',
  dim: '',
  red: '',
  green: '',
  yellow: '',
  blue: '',
  cyan: '',
};

/** Color palette, or all-empty strings when color is disabled (caller-safe). */
export function makePalette(color: boolean): Palette {
  return color ? COLOR_CODES : NO_COLOR_PALETTE;
}

/** The SGR reset code — the canonical sequence `truncate` appends after a cut. */
export const RESET = COLOR_CODES.reset;

/**
 * Bracketed status markers. The bracket is always ASCII (universal); the symbol
 * inside uses a unicode glyph when the terminal supports it (`[ ✓ ]`) and an
 * ASCII fallback otherwise (`[ + ]`) — never an emoji, so it renders identically
 * everywhere. The marker carries the meaning; color is additive. `spinnerFrames`
 * rotate inside the brackets for a live phase.
 */
export interface Markers {
  /** A finished step that succeeded (a spinner's success terminal). */
  done: string;
  /** Neutral information (rendered gray). */
  info: string;
  /** A finished step that degraded but continued, or a non-fatal warning. */
  warn: string;
  /** A failure. */
  error: string;
  /** A question put to the user (interactive prompts). */
  question: string;
  spinnerFrames: readonly string[];
}

const UNICODE_MARKERS: Markers = {
  done: '[ ✓ ]',
  info: '[ - ]',
  warn: '[ ! ]',
  error: '[ ✗ ]',
  question: '[ ? ]',
  spinnerFrames: [
    '[ ⠋ ]',
    '[ ⠙ ]',
    '[ ⠹ ]',
    '[ ⠸ ]',
    '[ ⠼ ]',
    '[ ⠴ ]',
    '[ ⠦ ]',
    '[ ⠧ ]',
    '[ ⠇ ]',
    '[ ⠏ ]',
  ],
};

const ASCII_MARKERS: Markers = {
  done: '[ + ]',
  info: '[ - ]',
  warn: '[ ! ]',
  error: '[ x ]',
  question: '[ ? ]',
  spinnerFrames: ['[ - ]', '[ \\ ]', '[ | ]', '[ / ]'],
};

/** Status markers; unicode glyphs when the terminal supports them, else ASCII. */
export function makeMarkers(unicode: boolean): Markers {
  return unicode ? UNICODE_MARKERS : ASCII_MARKERS;
}

// Full CSI matcher: ESC [ , params, intermediates, final byte. Covers SGR
// (`m`), cursor ops (`A`/`H`), and the `?25l`/`?25h` private sequences. Two
// instances: a global one for `stripAnsi`, a sticky (`y`) one for `matchAnsiAt`
// so width-aware truncation can test "is there an escape exactly here?" without
// the fragile global-`lastIndex` juggling.
// eslint-disable-next-line no-control-regex
const ANSI_GLOBAL = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ANSI_STICKY = /\x1b\[[0-?]*[ -/]*[@-~]/y;

/** Strip every ANSI escape so visible width / matching ignore color. */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_GLOBAL, '');
}

/**
 * If a full CSI escape begins exactly at `index`, return it; else `null`.
 * Stateless across calls (the sticky `lastIndex` is set per call), so it is safe
 * to interleave with other regex use.
 */
export function matchAnsiAt(line: string, index: number): string | null {
  ANSI_STICKY.lastIndex = index;
  const m = ANSI_STICKY.exec(line);
  return m ? m[0] : null;
}
