/**
 * Stateful extractor for the `content` field of a tool-input JSON value as
 * it streams in token-by-token from the AI SDK / @convex-dev/agent's
 * tool-input-delta rows. Lets the canvas decode partial content directly
 * from the chat-streaming infrastructure without us having to write our
 * own deltas table or per-chunk mutations.
 *
 * Pure function, no React / Convex imports — trivially unit-testable.
 *
 * Each call takes only the NEW chunk that arrived since the last call.
 * The state holds a small `carry` buffer for cross-chunk continuations
 * (a partial `"content":` key in pre-content phase, or a partial JSON
 * escape sequence in in-content phase). The carry is bounded to <16
 * bytes, so total work over the stream is O(N), independent of how many
 * chunks the stream is split into.
 *
 * Naive substring search for `"content":` is safe under the JSON spec:
 * an unescaped `"` cannot appear inside a string value, so the substring
 * `"content":` only matches the actual field key.
 */

export type ExtractPhase = 'pre-content' | 'in-content' | 'post-content';
export type EscapeMode = 'none' | 'simple' | 'unicode';

export interface ContentExtractState {
  phase: ExtractPhase;
  /**
   * Bytes carried over from the previous chunk we couldn't yet emit:
   *   - in `pre-content`: the most recent few bytes that might be the
   *     start of a `"content":` key spanning the chunk boundary.
   *   - in `in-content`: nothing (escapes use the dedicated fields below).
   * Bounded to a small constant (≤ KEY_PREFIX_BUFFER bytes).
   */
  carry: string;
  escapeMode: EscapeMode;
  /** Hex digits accumulated for the current `\uXXXX` escape. */
  unicodeBuffer: string;
  /**
   * If we just decoded a high surrogate (U+D800–U+DBFF) from a `\uXXXX`
   * escape but haven't seen the matching low surrogate yet, we hold it
   * here. The next `\uXXXX` decode looks here first to combine via
   * `String.fromCodePoint`. Stray surrogates emit U+FFFD with a warning.
   */
  bufferedHighSurrogate: number | null;
}

const KEY = '"content":';
/**
 * Max bytes to retain at end of the pre-content phase between chunks. We
 * only need enough to detect a `KEY` straddling the boundary, plus a few
 * bytes of slack for any whitespace before the opening `"`.
 */
const KEY_PREFIX_BUFFER = KEY.length + 8;
const REPLACEMENT_CHAR = '�';

export function initContentExtractState(): ContentExtractState {
  return {
    phase: 'pre-content',
    carry: '',
    escapeMode: 'none',
    unicodeBuffer: '',
    bufferedHighSurrogate: null,
  };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function decodeSimpleEscape(ch: string): string {
  switch (ch) {
    case '"':
      return '"';
    case '\\':
      return '\\';
    case '/':
      return '/';
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    default:
      // Invalid escape per RFC 8259 — keep the literal char so we can
      // recover deterministically rather than dropping bytes.
      return ch;
  }
}

/**
 * Decode the in-content portion of `text` starting at offset `i` until
 * either the unescaped `"` that terminates the content string, or the
 * end of `text` (chunk boundary). Mutates state for cross-chunk
 * continuation. Returns the decoded delta and whether the closing quote
 * was reached.
 */
function decodeInContent(
  state: ContentExtractState,
  text: string,
  start: number,
): { delta: string; finished: boolean; consumed: number } {
  let delta = '';
  let i = start;
  while (i < text.length) {
    const ch = text[i];

    if (state.escapeMode === 'unicode') {
      state.unicodeBuffer += ch;
      i += 1;
      if (state.unicodeBuffer.length === 4) {
        const code = parseInt(state.unicodeBuffer, 16);
        state.unicodeBuffer = '';
        state.escapeMode = 'none';
        if (Number.isNaN(code)) {
          delta += REPLACEMENT_CHAR;
        } else if (isHighSurrogate(code)) {
          if (state.bufferedHighSurrogate !== null) {
            delta += REPLACEMENT_CHAR;
            console.warn('[extract_content_stream] orphan high surrogate');
          }
          state.bufferedHighSurrogate = code;
        } else if (isLowSurrogate(code)) {
          if (state.bufferedHighSurrogate !== null) {
            const high = state.bufferedHighSurrogate;
            state.bufferedHighSurrogate = null;
            delta += String.fromCodePoint(
              ((high - 0xd800) << 10) + (code - 0xdc00) + 0x10000,
            );
          } else {
            delta += REPLACEMENT_CHAR;
            console.warn('[extract_content_stream] orphan low surrogate');
          }
        } else {
          if (state.bufferedHighSurrogate !== null) {
            delta += REPLACEMENT_CHAR;
            state.bufferedHighSurrogate = null;
            console.warn('[extract_content_stream] orphan high surrogate');
          }
          delta += String.fromCodePoint(code);
        }
      }
      continue;
    }

    if (state.escapeMode === 'simple') {
      if (ch === 'u') {
        state.escapeMode = 'unicode';
        state.unicodeBuffer = '';
        i += 1;
        continue;
      }
      if (state.bufferedHighSurrogate !== null) {
        delta += REPLACEMENT_CHAR;
        state.bufferedHighSurrogate = null;
        console.warn('[extract_content_stream] orphan high surrogate');
      }
      delta += decodeSimpleEscape(ch);
      state.escapeMode = 'none';
      i += 1;
      continue;
    }

    if (ch === '\\') {
      state.escapeMode = 'simple';
      i += 1;
      continue;
    }

    if (ch === '"') {
      if (state.bufferedHighSurrogate !== null) {
        delta += REPLACEMENT_CHAR;
        state.bufferedHighSurrogate = null;
        console.warn('[extract_content_stream] orphan high surrogate at end');
      }
      return { delta, finished: true, consumed: i + 1 - start };
    }

    if (state.bufferedHighSurrogate !== null) {
      delta += REPLACEMENT_CHAR;
      state.bufferedHighSurrogate = null;
      console.warn('[extract_content_stream] orphan high surrogate');
    }
    delta += ch;
    i += 1;
  }
  return { delta, finished: false, consumed: i - start };
}

/**
 * Feed the next chunk of accumulated tool-input bytes. Returns any
 * `content` characters that became visible since the previous call, plus
 * a `finished` flag once the closing `"` arrives.
 *
 * Per call work: O(chunk.length + |carry|). Carry is bounded to a small
 * constant. Total work over a stream of total size N: O(N).
 */
export function extractContentDelta(
  state: ContentExtractState,
  chunk: string,
): { delta: string; finished: boolean } {
  if (state.phase === 'post-content') {
    return { delta: '', finished: true };
  }

  // Phase 1: scan for `"content":` over (carry + chunk).
  if (state.phase === 'pre-content') {
    const combined = state.carry + chunk;
    const keyIdx = combined.indexOf(KEY);
    if (keyIdx === -1) {
      // Retain a small suffix in case the key straddles into the next chunk.
      state.carry = combined.slice(
        Math.max(0, combined.length - KEY_PREFIX_BUFFER),
      );
      return { delta: '', finished: false };
    }
    // Skip optional whitespace, then expect opening `"` of the value.
    let i = keyIdx + KEY.length;
    while (i < combined.length && /\s/.test(combined[i])) i += 1;
    if (i >= combined.length) {
      // Wait for more bytes; retain everything from keyIdx forward so we
      // can resume parsing the opening quote next time.
      state.carry = combined.slice(keyIdx);
      return { delta: '', finished: false };
    }
    if (combined[i] !== '"') {
      // Not a string value (e.g. `null`); we can't extract anything.
      state.phase = 'post-content';
      state.carry = '';
      return { delta: '', finished: true };
    }
    state.phase = 'in-content';
    state.carry = '';
    // Decode whatever's already past the opening quote.
    const result = decodeInContent(state, combined, i + 1);
    if (result.finished) state.phase = 'post-content';
    return { delta: result.delta, finished: result.finished };
  }

  // Phase 2: decode the chunk starting from offset 0 (no carry needed —
  // the escape state lives in escapeMode/unicodeBuffer/bufferedHighSurrogate).
  const result = decodeInContent(state, chunk, 0);
  if (result.finished) state.phase = 'post-content';
  return { delta: result.delta, finished: result.finished };
}
