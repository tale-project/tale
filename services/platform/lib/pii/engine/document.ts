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
 * Normalization happens once, up front: the whole text goes through
 * `normalizeForDetection` before it is windowed. The engine normalizes
 * again inside `scrub`, but the function is idempotent, so a window comes
 * back exactly as cut and the rewritten pieces join back offset for offset.
 * It also closes the clamp for good: NFC can grow text (U+0958 becomes
 * U+0915 U+093C), but it has already grown here, so a window of at most
 * `windowBytes / 4` UTF-16 code units — one code unit encodes to at most
 * four UTF-8 bytes — is under the clamp by `clampMessage`'s own fast path.
 * A `modified` document is therefore the normalized text with the engine's
 * rewrites; a `pass` says nothing about the text and the caller keeps its
 * original.
 *
 * Windowing: a cut prefers a paragraph break, then a line break, then a
 * space, searched back over the second half of the window, then falls back
 * to a hard cut — and no cut is accepted until it is checked. A space or a
 * hard cut lands inside any identifier that contains spaces or straddles
 * the boundary (`4111 1111 1111 1111`, a spaced IBAN or phone number, an
 * email at a hard cut), and an identifier split across two windows is seen
 * whole by neither: a block policy is walked past, a mask policy indexes
 * it raw. So every candidate cut is checked by the engine's own detector
 * over a window-sized neighbourhood centred on it, and a cut that a match
 * crosses moves to the match's start (nudged back to a preferred separator
 * when one sits in range). The neighbourhood is exactly one window long on
 * purpose: the detectors' size gates and budgets are calibrated to a window
 * (the phone detector drops its library pass past a cluster count that
 * grows with the text; the exec budgets are per window), so a longer region
 * would go blind exactly where the window scan still sees. The guarantee
 * that follows: no identifier shorter than half a window — 6,250 code units
 * at the default clamp, against patterns that top out in the low hundreds
 * and JWTs of a few thousand — is ever split by a cut. An identifier longer
 * than a whole window cannot be scanned whole by the engine at all and is
 * cut like any text.
 *
 * The check costs one extra window-sized detection per window (twice the
 * engine's own work) and more only when a cut actually moves, which is
 * rare: the first candidate already sits at a separator.
 *
 * The engine's `truncated` flag stays the authority on every verdict kind,
 * a `pass` included, as a guard: a scrubber built with a smaller `maxBytes`
 * than `windowBytes` says, or a scrubber that is not this engine, can still
 * clamp a window, and a clamped window with no match in its prefix says
 * nothing about its tail. Such a window is halved (with the same checked
 * cut) and rescanned; no text is ever indexed from a truncated scan.
 *
 * Aggregation follows the strongest verdict: any `blocked` window blocks
 * the document; any `step_error` (a window the engine could not scan)
 * surfaces so the caller decides fail-open or fail-closed — deliberately
 * ahead of `modified`, because a partially masked text would present an
 * unscanned window as scanned; a caller that fails open indexes its own
 * original text and says so. Otherwise the windows' texts are joined back
 * in order — rewritten where the engine rewrote, verbatim where it passed
 * — and the categories and match counts are unioned.
 */

import { normalizeForDetection } from '../core/normalize';
import {
  blocked,
  flagged,
  modified,
  pass,
  type FilterOutcome,
  type FilterStepErrorOutcome,
} from '../core/outcome';
import { MAX_MESSAGE_BYTES } from '../core/regex-safety';
import type { PiiMatch, PiiPattern } from '../core/types';
import { detectPii } from './detector';
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

/**
 * How many times a cut may move before it is placed exactly at the start
 * of the match crossing it. Each move re-checks a fresh neighbourhood; a
 * cut moves at all only when a separator sits inside an identifier, and
 * twice only in text dense with them.
 */
const MAX_CUT_MOVES = 4;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The preferred place to end the piece that starts at `start` and may not
 * run past `hardEnd`: after the last preferred separator in
 * `[minEnd, hardEnd)`, or at `hardEnd` itself — nudged back one unit when
 * that would split a surrogate pair. Unchecked: see `safeCutPoint`.
 */
function preferredCutPoint(
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

/**
 * The cut to use when `limit` is the start of an identifier: after the
 * last preferred separator that ends in `[minEnd, limit]`, or `limit`
 * itself.
 */
function cutBeforeMatch(text: string, limit: number, minEnd: number): number {
  for (const separator of CUT_SEPARATORS) {
    const at = text.lastIndexOf(separator, limit - separator.length);
    if (at >= 0 && at + separator.length >= minEnd)
      return at + separator.length;
  }
  return limit;
}

/**
 * The detector's matches over the window-sized neighbourhood centred on
 * `cut`, in absolute offsets. `detectPii` returns disjoint spans, so at
 * most one of them can cross any given position.
 */
function matchesAround(
  text: string,
  cut: number,
  halfWindow: number,
  patterns: ReadonlyArray<PiiPattern>,
): PiiMatch[] {
  const from = Math.max(0, cut - halfWindow);
  const to = Math.min(text.length, cut + halfWindow);
  return detectPii(text.slice(from, to), patterns).map((m) => ({
    patternName: m.patternName,
    replacement: m.replacement,
    matchedText: m.matchedText,
    start: m.start + from,
    end: m.end + from,
  }));
}

function crossing(matches: readonly PiiMatch[], cut: number): PiiMatch | null {
  return matches.find((m) => m.start < cut && m.end > cut) ?? null;
}

/**
 * Where to end the piece that starts at `start` and may not run past
 * `hardEnd`, such that no identifier the engine detects straddles the cut.
 * Starts from the preferred cut and moves it back to the start of any
 * match crossing it (see the header for the guarantee and its bound).
 * Always returns a position in `(start, hardEnd]`.
 */
function safeCutPoint(
  text: string,
  start: number,
  hardEnd: number,
  minEnd: number,
  patterns: ReadonlyArray<PiiPattern>,
): number {
  let cut = preferredCutPoint(text, start, hardEnd, minEnd);
  if (patterns.length === 0) return cut;
  const halfWindow = Math.ceil((hardEnd - start) / 2);

  for (let move = 0; ; move += 1) {
    const match = crossing(matchesAround(text, cut, halfWindow, patterns), cut);
    if (match === null) return cut;
    if (match.start <= start) {
      // The identifier covers the head of the window. It fits: cut right
      // after it — no other match in this neighbourhood crosses that point.
      // It does not fit: it is longer than a window, and the engine cannot
      // see it whole anywhere; the cut stands.
      return match.end <= hardEnd ? match.end : cut;
    }
    if (move === MAX_CUT_MOVES) return match.start;
    cut = cutBeforeMatch(text, match.start, minEnd);
  }
}

/**
 * Split `text` into consecutive pieces of at most `windowChars` units,
 * never cutting inside an identifier `patterns` would detect.
 */
export function splitIntoWindows(
  text: string,
  windowChars: number,
  patterns: ReadonlyArray<PiiPattern> = [],
): string[] {
  const size = Math.max(2, Math.floor(windowChars));
  const pieces: string[] = [];
  let start = 0;
  while (text.length - start > size) {
    const hardEnd = start + size;
    const end = safeCutPoint(
      text,
      start,
      hardEnd,
      start + Math.ceil(size / 2),
      patterns,
    );
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
  const mid = safeCutPoint(
    piece,
    0,
    Math.ceil(piece.length / 2),
    1,
    scrubber.patterns,
  );
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
  const normalized = normalizeForDetection(text);

  const scanned: Scanned[] = [];
  for (const piece of splitIntoWindows(
    normalized,
    windowChars,
    scrubber.patterns,
  )) {
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
