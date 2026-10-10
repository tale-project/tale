import type { CodeToken } from '../../../markdown/shiki';
import type { DiffLine, DiffWord, LineDiff } from './compute';

/**
 * The rows a code diff draws, from a line diff and what the reader opened:
 * a header before each hunk, the unchanged runs between hunks folded into
 * one row each until opened, and — past {@link CODE_DIFF_BUDGET}'s size —
 * a row that holds back the rest of a very large diff. Pure: the browser
 * test checks the picture, this checks the rules.
 */

/** A diff with more changed lines than `above` draws its first `shown`
 *  changed lines, then a row that shows the rest. */
export const CODE_DIFF_BUDGET = { above: 5_000, shown: 2_000 } as const;

export type CodeDiffRow =
  | { type: 'hunk'; key: string; hunk: number }
  /** Unchanged lines `start` to `end` (exclusive) folded into one row. */
  | { type: 'gap'; key: string; start: number; end: number; open: boolean }
  /** `revealed`: shown by opening a fold, so it fades in. */
  | { type: 'line'; key: string; line: DiffLine; revealed: boolean }
  /** The changed lines held back. */
  | { type: 'rest'; key: string; remaining: number };

export interface CodeDiffRowOptions {
  /** The folds the reader opened, by their row key. */
  open: ReadonlySet<string>;
  /** Draw a very large diff whole. */
  showAll?: boolean;
}

export function codeDiffRows(
  diff: LineDiff,
  { open, showAll = false }: CodeDiffRowOptions,
): CodeDiffRow[] {
  const rows: CodeDiffRow[] = [];
  const total = diff.added + diff.removed;
  const limit =
    !showAll && total > CODE_DIFF_BUDGET.above
      ? CODE_DIFF_BUDGET.shown
      : Number.POSITIVE_INFINITY;
  let drawn = 0;
  const fold = (start: number, end: number) => {
    if (end <= start) return;
    const key = `gap:${start}`;
    const opened = open.has(key);
    rows.push({ type: 'gap', key, start, end, open: opened });
    if (!opened) return;
    for (let index = start; index < end; index++) {
      const line = diff.lines[index];
      if (line !== undefined)
        rows.push({ type: 'line', key: `line:${index}`, line, revealed: true });
    }
  };
  let cursor = 0;
  for (const [hunk, range] of diff.hunks.entries()) {
    fold(cursor, range.start);
    rows.push({ type: 'hunk', key: `hunk:${hunk}`, hunk });
    for (let index = range.start; index < range.end; index++) {
      const line = diff.lines[index];
      if (line === undefined) continue;
      if (line.kind !== 'unchanged') {
        if (drawn >= limit) {
          rows.push({ type: 'rest', key: 'rest', remaining: total - drawn });
          return rows;
        }
        drawn++;
      }
      rows.push({ type: 'line', key: `line:${index}`, line, revealed: false });
    }
    cursor = range.end;
  }
  fold(cursor, diff.lines.length);
  return rows;
}

/** A row of the side-by-side layout: the line on each side, or none where
 *  one side has no line in its place. */
export type CodeDiffSplitRow =
  | Exclude<CodeDiffRow, { type: 'line' }>
  | {
      type: 'pair';
      key: string;
      left?: DiffLine;
      right?: DiffLine;
      revealed: boolean;
    };

/**
 * The rows side by side: an unchanged line on both sides, and in each
 * change its removed lines beside the lines added in their place, in
 * order — the longer side's extra lines face an empty cell.
 */
export function splitRows(rows: readonly CodeDiffRow[]): CodeDiffSplitRow[] {
  const out: CodeDiffSplitRow[] = [];
  let removed: Array<Extract<CodeDiffRow, { type: 'line' }>> = [];
  let added: Array<Extract<CodeDiffRow, { type: 'line' }>> = [];
  const pairUp = () => {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index++) {
      const left = removed[index];
      const right = added[index];
      out.push({
        type: 'pair',
        key: `pair:${left?.key ?? ''}|${right?.key ?? ''}`,
        ...(left === undefined ? {} : { left: left.line }),
        ...(right === undefined ? {} : { right: right.line }),
        revealed: [left, right].some((row) => row?.revealed),
      });
    }
    removed = [];
    added = [];
  };
  for (const row of rows) {
    if (row.type === 'line' && row.line.kind === 'removed') {
      if (added.length > 0) pairUp();
      removed.push(row);
    } else if (row.type === 'line' && row.line.kind === 'added') {
      added.push(row);
    } else {
      pairUp();
      if (row.type === 'line')
        out.push({
          type: 'pair',
          key: `pair:${row.key}`,
          left: row.line,
          right: row.line,
          revealed: row.revealed,
        });
      else out.push(row);
    }
  }
  pairUp();
  return out;
}

/** A run of a line as drawn: its text, its token colour and style, and
 *  whether it is a word that changed. */
export interface CodeDiffSegment {
  text: string;
  color?: string;
  fontStyle?: number;
  changed: boolean;
}

/**
 * A line's text cut where its highlight's tokens and its changed words
 * begin and end, so each run takes both its colour and its emphasis. Tokens
 * or words that do not spell the line's text (a highlight still loading, a
 * line break Shiki read differently) are left out rather than misplaced.
 */
export function lineSegments(
  text: string,
  tokens: readonly CodeToken[] | null | undefined,
  words: readonly DiffWord[] | undefined,
): CodeDiffSegment[] {
  const runs: readonly CodeToken[] =
    tokens != null && tokens.map((token) => token.content).join('') === text
      ? tokens
      : [{ content: text }];
  const marks: readonly DiffWord[] =
    words !== undefined && words.map((word) => word.text).join('') === text
      ? words
      : [{ text, changed: false }];
  const out: CodeDiffSegment[] = [];
  let tokenAt = 0;
  let wordAt = 0;
  let inToken = 0;
  let inWord = 0;
  while (tokenAt < runs.length && wordAt < marks.length) {
    const token = runs[tokenAt];
    const word = marks[wordAt];
    if (token === undefined || word === undefined) break;
    const take = Math.min(
      token.content.length - inToken,
      word.text.length - inWord,
    );
    if (take > 0) {
      const piece = token.content.slice(inToken, inToken + take);
      const last = out[out.length - 1];
      if (
        last !== undefined &&
        last.changed === word.changed &&
        last.color === token.color &&
        last.fontStyle === token.fontStyle
      ) {
        out[out.length - 1] = { ...last, text: last.text + piece };
      } else {
        out.push({
          text: piece,
          changed: word.changed,
          ...(token.color === undefined ? {} : { color: token.color }),
          ...(token.fontStyle === undefined
            ? {}
            : { fontStyle: token.fontStyle }),
        });
      }
    }
    inToken += take;
    inWord += take;
    if (inToken >= token.content.length) {
      tokenAt++;
      inToken = 0;
    }
    if (inWord >= word.text.length) {
      wordAt++;
      inWord = 0;
    }
  }
  return out;
}
