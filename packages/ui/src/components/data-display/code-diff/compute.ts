/**
 * Two texts compared line by line: the pure core of `CodeDiff`, and the one
 * unified patch the product writes. No React, no DOM, no other module of
 * the package — it imports jsdiff alone, so the automation engine writes
 * its patches with it on the server (`compute.test.ts` holds it to that).
 */

import {
  createTwoFilesPatch,
  diffLines,
  diffWordsWithSpace,
  FILE_HEADERS_ONLY,
  formatPatch,
  type Change,
} from 'diff';

export type DiffLineKind = 'unchanged' | 'added' | 'removed';

/** A run of a changed line's text; `changed` marks what differs from the
 *  line it replaced, or was replaced by. */
export interface DiffWord {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: DiffLineKind;
  /** The line's text, without its line break. */
  text: string;
  /** Its number in `before`, from 1: an unchanged or a removed line. */
  before?: number;
  /** Its number in `after`, from 1: an unchanged or an added line. */
  after?: number;
  /**
   * A removed line paired with the added line in its place (or the other
   * way round): its text in runs, the words that changed marked. Absent
   * when the two share no word, or either is too long to compare.
   */
  words?: readonly DiffWord[];
}

/** Where a hunk sits in one of the texts: its first line (from 1) and how
 *  many lines it spans there. A side it spans no line of starts at the line
 *  before it, as a unified patch writes it (`-4,0`). */
export interface DiffRange {
  start: number;
  count: number;
}

/** One or more changes with the unchanged lines around them. */
export interface DiffHunk {
  /** Its lines: `lines.slice(start, end)`. */
  start: number;
  end: number;
  before: DiffRange;
  after: DiffRange;
  added: number;
  removed: number;
}

export interface LineDiff {
  /**
   * Every line of both texts in reading order: an unchanged line once, a
   * change's removed lines before the lines added in their place.
   */
  lines: readonly DiffLine[];
  /** The changes with their context; the lines between two hunks are the
   *  unchanged runs a reader can fold away. */
  hunks: readonly DiffHunk[];
  added: number;
  removed: number;
  identical: boolean;
}

export interface LineDiffOptions {
  /** Unchanged lines kept around each change: 3. */
  context?: number;
  /** Mark the words that changed between a removed line and the added line
   *  in its place: on. */
  words?: boolean;
  /**
   * The most lines added and removed the diff looks for:
   * {@link DIFF_MAX_EDITS}. Two texts further apart than that read as one
   * removed whole and one added whole, without word marks.
   */
  maxEditLength?: number;
}

/** Unchanged lines kept around a change. */
export const DIFF_CONTEXT = 3;

/** The longest line whose words are compared, in characters. */
export const WORD_DIFF_MAX_CHARS = 500;

/**
 * The most lines added and removed a diff looks for. The search grows with
 * the square of this bound: two unrelated texts of 256 KB take about half
 * a second to give up at 2 000, and ten seconds at 10 000. Past it, the
 * view and the patch both read as one text removed and one added, so the
 * patch a reader copies matches the diff they see.
 */
export const DIFF_MAX_EDITS = 2_000;

/** The lines of a run of text, without their line breaks: a final line
 *  break ends the last line rather than opening another. */
function linesOf(value: string): string[] {
  if (value === '') return [];
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** One run's text appended to the last word when it is of the same kind. */
function appendWord(words: DiffWord[], text: string, changed: boolean): void {
  const last = words[words.length - 1];
  if (last !== undefined && last.changed === changed) {
    words[words.length - 1] = { text: last.text + text, changed };
  } else {
    words.push({ text, changed });
  }
}

/**
 * The words that changed between two lines, each line as runs of its own
 * text. `null` when there is nothing to mark: either line is longer than
 * {@link WORD_DIFF_MAX_CHARS}, the two are the same, or they share no word
 * (the whole line changed, and its tint says so).
 */
export function diffWords(
  before: string,
  after: string,
): { before: DiffWord[]; after: DiffWord[] } | null {
  if (
    before.length > WORD_DIFF_MAX_CHARS ||
    after.length > WORD_DIFF_MAX_CHARS ||
    before === after
  ) {
    return null;
  }
  const left: DiffWord[] = [];
  const right: DiffWord[] = [];
  let shared = false;
  for (const part of diffWordsWithSpace(before, after)) {
    if (part.added) appendWord(right, part.value, true);
    else if (part.removed) appendWord(left, part.value, true);
    else {
      appendWord(left, part.value, false);
      appendWord(right, part.value, false);
      if (/\S/.test(part.value)) shared = true;
    }
  }
  return shared ? { before: left, after: right } : null;
}

/** The two texts as one removed whole and one added whole. */
function wholeReplacement(before: string, after: string): Change[] {
  const parts: Change[] = [];
  if (before !== '')
    parts.push({ value: before, added: false, removed: true, count: 0 });
  if (after !== '')
    parts.push({ value: after, added: true, removed: false, count: 0 });
  return parts;
}

/**
 * The hunks of `lines`: each change with `context` unchanged lines on
 * either side. Two changes whose context would leave a single line between
 * them share a hunk, and a single line at either end joins its hunk, so
 * folding away never hides just one line.
 */
function hunksOf(lines: readonly DiffLine[], context: number): DiffHunk[] {
  const groups: Array<{ first: number; last: number }> = [];
  lines.forEach((line, index) => {
    if (line.kind === 'unchanged') return;
    const open = groups[groups.length - 1];
    if (open !== undefined && index - open.last - 1 <= 2 * context + 1) {
      open.last = index;
    } else {
      groups.push({ first: index, last: index });
    }
  });
  return groups.map(({ first, last }) => {
    let start = Math.max(0, first - context);
    let end = Math.min(lines.length, last + 1 + context);
    if (start === 1) start = 0;
    if (lines.length - end === 1) end = lines.length;
    return rangeOf(lines, start, end);
  });
}

function rangeOf(
  lines: readonly DiffLine[],
  start: number,
  end: number,
): DiffHunk {
  const side = (key: 'before' | 'after'): DiffRange => {
    let first: number | undefined;
    let count = 0;
    for (let index = start; index < end; index++) {
      const number = lines[index]?.[key];
      if (number === undefined) continue;
      first ??= number;
      count++;
    }
    if (first !== undefined) return { start: first, count };
    // The line before the hunk on this side, or 0 at the top.
    for (let index = start - 1; index >= 0; index--) {
      const number = lines[index]?.[key];
      if (number !== undefined) return { start: number, count: 0 };
    }
    return { start: 0, count: 0 };
  };
  let added = 0;
  let removed = 0;
  for (let index = start; index < end; index++) {
    const kind = lines[index]?.kind;
    if (kind === 'added') added++;
    else if (kind === 'removed') removed++;
  }
  return {
    start,
    end,
    before: side('before'),
    after: side('after'),
    added,
    removed,
  };
}

/**
 * What changed between two texts, line by line: every line of both in
 * reading order with its numbers, the hunks a reader steps through, and
 * the words that changed inside each pair of a removed line and the added
 * line in its place.
 */
export function computeLineDiff(
  before: string,
  after: string,
  options: LineDiffOptions = {},
): LineDiff {
  const context = Math.max(0, Math.floor(options.context ?? DIFF_CONTEXT));
  const found =
    before === after
      ? [{ value: before, added: false, removed: false, count: 0 }]
      : diffLines(before, after, {
          maxEditLength: options.maxEditLength ?? DIFF_MAX_EDITS,
        });
  const parts: Change[] = found ?? wholeReplacement(before, after);
  // Two texts too far apart pair lines that have nothing to do with each
  // other: no words to mark there.
  const markWords = (options.words ?? true) && found !== undefined;

  const lines: DiffLine[] = [];
  let beforeLine = 0;
  let afterLine = 0;
  let added = 0;
  let removed = 0;
  let removedRun: DiffLine[] = [];
  let addedRun: DiffLine[] = [];
  // A change ends where an unchanged line begins: its removed lines go
  // first, then the lines added in their place, paired for their words.
  const endChange = () => {
    if (markWords) {
      const pairs = Math.min(removedRun.length, addedRun.length);
      for (let index = 0; index < pairs; index++) {
        const left = removedRun[index];
        const right = addedRun[index];
        if (left === undefined || right === undefined) continue;
        const words = diffWords(left.text, right.text);
        if (words === null) continue;
        removedRun[index] = { ...left, words: words.before };
        addedRun[index] = { ...right, words: words.after };
      }
    }
    lines.push(...removedRun, ...addedRun);
    removedRun = [];
    addedRun = [];
  };
  for (const part of parts) {
    const texts = linesOf(part.value);
    if (part.added) {
      for (const text of texts) {
        afterLine++;
        addedRun.push({ kind: 'added', text, after: afterLine });
      }
      added += texts.length;
    } else if (part.removed) {
      for (const text of texts) {
        beforeLine++;
        removedRun.push({ kind: 'removed', text, before: beforeLine });
      }
      removed += texts.length;
    } else {
      endChange();
      for (const text of texts) {
        beforeLine++;
        afterLine++;
        lines.push({
          kind: 'unchanged',
          text,
          before: beforeLine,
          after: afterLine,
        });
      }
    }
  }
  endChange();
  return {
    lines,
    hunks: hunksOf(lines, context),
    added,
    removed,
    identical: added === 0 && removed === 0,
  };
}

/** The longest patch answered by default, in UTF-8 bytes. */
export const MAX_PATCH_BYTES = 262_144;

export interface UnifiedPatchOptions {
  /** The name each side goes by in the headers: `v4`, `v5`. */
  from: string;
  to: string;
  /** Unchanged lines kept around each change: 3. */
  context?: number;
  /** The longest patch answered, in UTF-8 bytes: 262 144. Pass `Infinity`
   *  for the whole patch, however long. */
  maxBytes?: number;
}

export interface UnifiedPatch {
  patch: string;
  /** The patch was cut at `maxBytes`: it shows what changed but no longer
   *  applies. */
  truncated: boolean;
}

/** The lines of a text as a patch holds them, each with its line break
 *  but a last line the text does not end with (jsdiff's own split). */
function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n').map((line) => `${line}\n`);
  const last = lines.pop() ?? '';
  if (!text.endsWith('\n')) lines.push(last.slice(0, -1));
  return lines;
}

/**
 * The patch that removes every line of `before` and adds every line of
 * `after`, as jsdiff writes it for two texts that share no line: one hunk,
 * no context, "\ No newline at end of file" after a last line without one.
 */
function wholeReplacementPatch(
  before: string,
  after: string,
  from: string,
  to: string,
): string {
  const removed = patchLines(before);
  const added = patchLines(after);
  const lines: string[] = [];
  for (const line of [
    ...removed.map((text) => `-${text}`),
    ...added.map((text) => `+${text}`),
  ]) {
    if (line.endsWith('\n')) lines.push(line.slice(0, -1));
    else lines.push(line, '\\ No newline at end of file');
  }
  return formatPatch(
    {
      oldFileName: from,
      newFileName: to,
      oldHeader: undefined,
      newHeader: undefined,
      hunks: [
        {
          oldStart: 1,
          oldLines: removed.length,
          newStart: 1,
          newLines: added.length,
          lines,
        },
      ],
    },
    FILE_HEADERS_ONLY,
  );
}

/** The longest prefix of `text` made of whole lines that fits `maxBytes`. */
function wholeLinesWithin(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let kept = 0;
  let bytes = 0;
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    const size = encoder.encode(text.slice(start, end)).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    kept = end;
    start = end;
  }
  return text.slice(0, kept);
}

/**
 * The unified patch that turns `before` into `after`: jsdiff's
 * `createTwoFilesPatch` with file headers only, the shape `git diff` and
 * `patch` read — `--- v4` and `+++ v5`, then each hunk with `context`
 * unchanged lines around its changes. Two equal texts have no patch (`''`).
 * Two texts more than {@link DIFF_MAX_EDITS} lines apart give one hunk that
 * replaces the whole text, as the diff shows them. A patch longer than
 * `maxBytes` (UTF-8) stops at the last whole line that fits and says it
 * was cut.
 */
export function toUnifiedPatch(
  before: string,
  after: string,
  options: UnifiedPatchOptions,
): UnifiedPatch {
  if (before === after) return { patch: '', truncated: false };
  const patch =
    createTwoFilesPatch(
      options.from,
      options.to,
      before,
      after,
      undefined,
      undefined,
      {
        context: options.context ?? DIFF_CONTEXT,
        headerOptions: FILE_HEADERS_ONLY,
        maxEditLength: DIFF_MAX_EDITS,
      },
    ) ?? wholeReplacementPatch(before, after, options.from, options.to);
  const maxBytes = options.maxBytes ?? MAX_PATCH_BYTES;
  if (new TextEncoder().encode(patch).length <= maxBytes) {
    return { patch, truncated: false };
  }
  return { patch: wholeLinesWithin(patch, maxBytes), truncated: true };
}
