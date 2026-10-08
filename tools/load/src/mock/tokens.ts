/**
 * Token accounting without a tokenizer.
 *
 * A real BPE vocabulary is megabytes of data and costs a CPU core at load;
 * the mock needs only counts that behave like real ones (about four
 * characters a token for English prose, more for long words, numbers and
 * symbols) and that agree EXACTLY with what it streams. So text is cut into
 * pieces the way a GPT pre-tokenizer cuts it — a word with its leading
 * space, digits in groups of three, a symbol or a short run of one symbol,
 * newlines — and every piece is one token. Long words split into several
 * pieces. The count of a text is the number of its pieces, and a reply
 * streamed as pieces reports a `completion_tokens` equal to what the client
 * can count back.
 */

/** Letters a single word piece holds before the word splits. */
const WORD_PIECE_LETTERS = 7;
/** Digits per number piece (GPT-4 era vocabularies group up to three). */
const DIGIT_PIECE = 3;
/** A run of one repeated symbol (`**`, `---`, a code fence) is one piece. */
const SYMBOL_RUN = 3;
/** Consecutive newlines one piece holds. */
const NEWLINE_RUN = 2;

const SPACE = 32;
const TAB = 9;
const LF = 10;
const CR = 13;

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** Latin letters beyond ASCII (accents, umlauts, ß) — not × and ÷. */
function isLatinLetter(code: number): boolean {
  return code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isNewline(code: number): boolean {
  return code === LF || code === CR;
}

function isBlank(code: number): boolean {
  return code === SPACE || code === TAB;
}

/** Where a piece ends; `onPiece` is told about each one. */
type PieceSink = (start: number, end: number) => void;

/**
 * Cut `text` into pieces, reporting each to `onPiece` when given, and
 * return how many there are. One pass, no allocation without a sink.
 */
function scanPieces(text: string, onPiece?: PieceSink): number {
  const length = text.length;
  let pieces = 0;
  let i = 0;
  while (i < length) {
    const start = i;
    let code = text.charCodeAt(i);

    if (isNewline(code)) {
      let newlines = 0;
      while (i < length && isNewline(text.charCodeAt(i))) {
        if (text.charCodeAt(i) === LF) {
          if (newlines === NEWLINE_RUN) break;
          newlines += 1;
        }
        i += 1;
      }
      pieces += 1;
      onPiece?.(start, i);
      continue;
    }

    if (isBlank(code)) {
      let end = i;
      while (end < length && isBlank(text.charCodeAt(end))) end += 1;
      const followedByContent =
        end < length && !isNewline(text.charCodeAt(end));
      if (!followedByContent) {
        // Trailing blanks before a newline or the end: one piece.
        i = end;
        pieces += 1;
        onPiece?.(start, i);
        continue;
      }
      if (end - start > 1) {
        // Indentation: every blank but the last is one piece; the last
        // space rides with the word that follows, as BPE merges it.
        i = end - 1;
        pieces += 1;
        onPiece?.(start, i);
        continue;
      }
      // A single blank: it opens the next piece.
      i += 1;
      code = text.charCodeAt(i);
    }

    if (isAsciiLetter(code) || isLatinLetter(code)) {
      let weight = 0;
      while (i < length) {
        const next = text.charCodeAt(i);
        const ascii = isAsciiLetter(next);
        if (!ascii && !isLatinLetter(next)) break;
        // A non-ASCII letter costs a BPE vocabulary more than one slot.
        const cost = ascii ? 1 : 2;
        if (weight > 0 && weight + cost > WORD_PIECE_LETTERS) break;
        weight += cost;
        i += 1;
      }
    } else if (isDigit(code)) {
      let digits = 0;
      while (
        i < length &&
        digits < DIGIT_PIECE &&
        isDigit(text.charCodeAt(i))
      ) {
        digits += 1;
        i += 1;
      }
    } else {
      // A symbol: a short run of the same symbol stays one piece. Surrogate
      // pairs (emoji) stay whole.
      const high = code >= 0xd800 && code <= 0xdbff;
      i += high && i + 1 < length ? 2 : 1;
      if (!high) {
        let run = 1;
        while (i < length && run < SYMBOL_RUN) {
          if (text.charCodeAt(i) !== code) break;
          run += 1;
          i += 1;
        }
      }
    }
    pieces += 1;
    onPiece?.(start, i);
  }
  return pieces;
}

/** The token count of `text`. */
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : scanPieces(text);
}

/** The longest prefix of `text` that is at most `maxTokens` tokens. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return '';
  let seen = 0;
  let cut = text.length;
  scanPieces(text, (_start, end) => {
    seen += 1;
    if (seen === maxTokens) cut = Math.min(cut, end);
  });
  return seen <= maxTokens ? text : text.slice(0, cut);
}

/**
 * `text` cut into stream chunks of `tokensPerChunk` tokens (the last one
 * may be shorter). Joining the chunks gives `text` back.
 */
export function chunkByTokens(text: string, tokensPerChunk: number): string[] {
  const chunks: string[] = [];
  if (text.length === 0) return chunks;
  const size = Math.max(1, Math.floor(tokensPerChunk));
  let inChunk = 0;
  let chunkStart = 0;
  scanPieces(text, (_start, end) => {
    inChunk += 1;
    if (inChunk === size) {
      chunks.push(text.slice(chunkStart, end));
      chunkStart = end;
      inChunk = 0;
    }
  });
  if (chunkStart < text.length) chunks.push(text.slice(chunkStart));
  return chunks;
}

/**
 * Tokens in chunk `index` of `count` chunks cut by `chunkByTokens` from a
 * text of `total` tokens: every chunk is full but the last.
 */
export function chunkShare(
  index: number,
  count: number,
  total: number,
  tokensPerChunk: number,
): number {
  const size = Math.max(1, Math.floor(tokensPerChunk));
  return index < count - 1 ? size : total - size * (count - 1);
}
