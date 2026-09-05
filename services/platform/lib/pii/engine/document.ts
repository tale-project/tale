/**
 * Whole-document scanning over the chat-sized engine.
 *
 * `Scrubber.scrub` clamps its input to `MAX_MESSAGE_BYTES` before any
 * regex runs — the right defence for a chat message, where a 10 MB paste is
 * an attack, not content. A document bound for the index is the opposite:
 * its text routinely runs past the clamp, and indexing the clamped output
 * would drop the tail of the document while a match past the clamp would
 * never be seen. `scrubDocument` keeps the engine's clamp exactly as it is
 * and scans in windows instead.
 *
 * Windowing: the text is cut into pieces of at most `windowBytes / 4`
 * UTF-16 code units — one code unit encodes to at most four UTF-8 bytes,
 * so every piece is under the clamp as cut (`clampMessage`'s own fast
 * path). A cut prefers a paragraph break, then a line break, then a space,
 * searched back over the second half of the window, so a match is only
 * ever split when a single paragraph is longer than the window and has no
 * break to cut at.
 *
 * Normalization can still grow a piece past the clamp: the engine runs NFC
 * before it clamps, and a composition-excluded code point decomposes under
 * NFC (U+0958 becomes U+0915 U+093C — three UTF-8 bytes become six), so a
 * window of them is clamped inside `scrub` after all. The engine's
 * `truncated` flag is therefore the authority, on every verdict kind
 * including `pass` — a clamped window with no match in its prefix says
 * nothing about its tail. A window that comes back truncated is halved and
 * rescanned; no text is ever indexed from a truncated scan.
 *
 * Aggregation follows the strongest verdict: any `blocked` window blocks
 * the document; any `step_error` (a window the engine could not scan)
 * surfaces so the caller decides fail-open or fail-closed; otherwise the
 * windows' texts are joined back in order — rewritten where the engine
 * rewrote, verbatim where it passed — and the categories and match counts
 * are unioned.
 */

import {
  blocked,
  flagged,
  modified,
  pass,
  type FilterOutcome,
  type FilterStepErrorOutcome,
} from '../core/outcome';
import { MAX_MESSAGE_BYTES } from '../core/regex-safety';
import type { Scrubber } from './scrubber';

export interface ScrubDocumentOptions {
  /**
   * The scrubber's input clamp in bytes. Defaults to the engine default;
   * a scrubber built with a custom `maxBytes` must be given the same value
   * here, or its windows would be clamped after all.
   */
  readonly windowBytes?: number;
}

/** Cut boundaries, most preferred first. */
const CUT_SEPARATORS = ['\n\n', '\n', ' '] as const;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Where to end the piece that starts at `start` and may not run past
 * `hardEnd`: after the last preferred separator in `[minEnd, hardEnd)`, or
 * at `hardEnd` itself — nudged back one unit when that would split a
 * surrogate pair.
 */
function cutPoint(
  text: string,
  start: number,
  hardEnd: number,
  minEnd: number,
): number {
  for (const separator of CUT_SEPARATORS) {
    const at = text.lastIndexOf(separator, hardEnd - separator.length);
    if (at >= minEnd) return at + separator.length;
  }
  if (hardEnd - start > 1 && isHighSurrogate(text.charCodeAt(hardEnd - 1))) {
    return hardEnd - 1;
  }
  return hardEnd;
}

/** Split `text` into consecutive pieces of at most `windowChars` units. */
export function splitIntoWindows(text: string, windowChars: number): string[] {
  const size = Math.max(2, Math.floor(windowChars));
  const pieces: string[] = [];
  let start = 0;
  while (text.length - start > size) {
    const hardEnd = start + size;
    const end = cutPoint(text, start, hardEnd, start + Math.ceil(size / 2));
    pieces.push(text.slice(start, end));
    start = end;
  }
  pieces.push(text.slice(start));
  return pieces;
}

interface Scanned {
  readonly piece: string;
  readonly outcome: FilterOutcome;
}

function truncatedStepError(): FilterStepErrorOutcome {
  return {
    kind: 'step_error',
    filterName: 'pii',
    reason: 'truncated: a window could not be scanned whole',
  };
}

/**
 * Scan one piece; a truncated verdict — of any kind, a `pass` included —
 * halves the piece and rescans both halves. A single code unit cannot be
 * truncated by the engine, so the recursion ends; the step error below is
 * the unreachable floor, kept so a truncated scan can never be returned as
 * a result.
 */
function scanPiece(scrubber: Scrubber, piece: string): Scanned[] {
  const outcome = scrubber.scrub(piece);
  const truncated = outcome.kind !== 'step_error' && outcome.truncated === true;
  if (!truncated) return [{ piece, outcome }];
  if (piece.length <= 1) return [{ piece, outcome: truncatedStepError() }];
  const mid = cutPoint(piece, 0, Math.ceil(piece.length / 2), 1);
  return [
    ...scanPiece(scrubber, piece.slice(0, mid)),
    ...scanPiece(scrubber, piece.slice(mid)),
  ];
}

function unionCategories(scanned: readonly Scanned[]): string[] {
  const seen = new Set<string>();
  for (const { outcome } of scanned) {
    if (outcome.kind === 'pass' || outcome.kind === 'step_error') continue;
    for (const id of outcome.categoryIds) seen.add(id);
  }
  return [...seen];
}

function sumMatches(scanned: readonly Scanned[]): number {
  let total = 0;
  for (const { outcome } of scanned) {
    if (outcome.kind === 'pass' || outcome.kind === 'step_error') continue;
    total += outcome.matchCount;
  }
  return total;
}

/**
 * Scrub a document of any length with a chat-sized scrubber. The verdict
 * never carries `truncated`: every window was scanned whole.
 */
export function scrubDocument(
  scrubber: Scrubber,
  text: string,
  options: ScrubDocumentOptions = {},
): FilterOutcome {
  if (text.length === 0) return pass();
  const windowBytes = options.windowBytes ?? MAX_MESSAGE_BYTES;
  const windowChars = Math.floor(windowBytes / 4);

  const scanned: Scanned[] = [];
  for (const piece of splitIntoWindows(text, windowChars)) {
    scanned.push(...scanPiece(scrubber, piece));
  }

  if (scanned.some(({ outcome }) => outcome.kind === 'blocked')) {
    return blocked(unionCategories(scanned), sumMatches(scanned));
  }
  const stepError = scanned.find(
    ({ outcome }) => outcome.kind === 'step_error',
  );
  if (stepError !== undefined) return stepError.outcome;

  if (scanned.some(({ outcome }) => outcome.kind === 'modified')) {
    const rewritten = scanned
      .map(({ piece, outcome }) =>
        outcome.kind === 'modified' ? outcome.text : piece,
      )
      .join('');
    return modified(rewritten, unionCategories(scanned), sumMatches(scanned));
  }
  if (scanned.some(({ outcome }) => outcome.kind === 'flagged')) {
    return flagged(unionCategories(scanned), sumMatches(scanned));
  }
  return pass();
}
