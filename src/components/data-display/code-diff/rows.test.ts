import { describe, expect, it } from 'vitest';

import { computeLineDiff } from './compute';
import {
  CODE_DIFF_BUDGET,
  codeDiffRows,
  lineSegments,
  splitRows,
  type CodeDiffRow,
} from './rows';

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, at) => `${prefix} ${at + 1}\n`).join(
    '',
  );
}

/** A row in a word: a hunk header, a fold, a line with its sign, the rest. */
function shape(row: CodeDiffRow): string {
  switch (row.type) {
    case 'hunk':
      return `@${row.hunk}`;
    case 'gap':
      return `~${row.end - row.start}${row.open ? ' open' : ''}`;
    case 'rest':
      return `…${row.remaining}`;
    default:
      return `${row.line.kind === 'added' ? '+' : row.line.kind === 'removed' ? '-' : ' '}${row.line.text}${row.revealed ? ' (revealed)' : ''}`;
  }
}

const NONE: ReadonlySet<string> = new Set();

describe('codeDiffRows', () => {
  const before = lines(30);
  const after = before
    .replace('line 6\n', 'line six\n')
    .replace('line 20\n', 'line twenty\n');
  const diff = computeLineDiff(before, after);

  it('heads each hunk and folds the unchanged runs between and around them', () => {
    expect(codeDiffRows(diff, { open: NONE }).map(shape)).toEqual([
      '~2',
      '@0',
      ' line 3',
      ' line 4',
      ' line 5',
      '-line 6',
      '+line six',
      ' line 7',
      ' line 8',
      ' line 9',
      '~7',
      '@1',
      ' line 17',
      ' line 18',
      ' line 19',
      '-line 20',
      '+line twenty',
      ' line 21',
      ' line 22',
      ' line 23',
      '~7',
    ]);
  });

  it('lists an opened fold’s lines under it, to fade in', () => {
    const rows = codeDiffRows(diff, { open: new Set(['gap:10']) });
    const at = rows.findIndex((row) => row.key === 'gap:10');
    expect(rows.slice(at, at + 3).map(shape)).toEqual([
      '~7 open',
      ' line 10 (revealed)',
      ' line 11 (revealed)',
    ]);
    expect(rows.filter((row) => row.type === 'line')).toHaveLength(16 + 7);
  });

  it('draws the first changed lines of a very large diff and holds back the rest', () => {
    const half = CODE_DIFF_BUDGET.above / 2 + 1;
    const huge = computeLineDiff(lines(half, 'old'), lines(half, 'new'));
    expect(huge.added + huge.removed).toBeGreaterThan(CODE_DIFF_BUDGET.above);
    const rows = codeDiffRows(huge, { open: NONE });
    const changed = rows.filter(
      (row) => row.type === 'line' && row.line.kind !== 'unchanged',
    );
    expect(changed).toHaveLength(CODE_DIFF_BUDGET.shown);
    expect(rows.at(-1)).toEqual({
      type: 'rest',
      key: 'rest',
      remaining: huge.added + huge.removed - CODE_DIFF_BUDGET.shown,
    });
    const all = codeDiffRows(huge, { open: NONE, showAll: true });
    expect(all.some((row) => row.type === 'rest')).toBe(false);
    expect(
      all.filter((row) => row.type === 'line' && row.line.kind !== 'unchanged'),
    ).toHaveLength(huge.added + huge.removed);
  });
});

describe('splitRows', () => {
  it('sets a change’s removed lines beside the lines added in their place', () => {
    const diff = computeLineDiff(
      'keep\nname: a\nmode: x\nkeep 2\n',
      'keep\nname: b\nkeep 2\nadded\n',
    );
    const rows = splitRows(codeDiffRows(diff, { open: NONE }));
    expect(
      rows.map((row) =>
        row.type === 'pair'
          ? `${row.left?.text ?? '∅'} | ${row.right?.text ?? '∅'}`
          : row.type,
      ),
    ).toEqual([
      'hunk',
      'keep | keep',
      'name: a | name: b',
      'mode: x | ∅',
      'keep 2 | keep 2',
      '∅ | added',
    ]);
  });
});

describe('lineSegments', () => {
  it('cuts a line where its tokens and its changed words begin and end', () => {
    expect(
      lineSegments(
        'model: claude-haiku',
        [
          { content: 'model', color: 'var(--code-token-keyword)' },
          { content: ': ', color: 'var(--code-token-punctuation)' },
          { content: 'claude-haiku', color: 'var(--code-token-string)' },
        ],
        [
          { text: 'model: claude-', changed: false },
          { text: 'haiku', changed: true },
        ],
      ),
    ).toEqual([
      {
        text: 'model',
        color: 'var(--code-token-keyword)',
        changed: false,
      },
      {
        text: ': ',
        color: 'var(--code-token-punctuation)',
        changed: false,
      },
      {
        text: 'claude-',
        color: 'var(--code-token-string)',
        changed: false,
      },
      { text: 'haiku', color: 'var(--code-token-string)', changed: true },
    ]);
  });

  it('draws plain text where the tokens or words do not spell the line', () => {
    expect(
      lineSegments(
        'a b',
        [{ content: 'a c' }],
        [{ text: 'a b', changed: true }],
      ),
    ).toEqual([{ text: 'a b', changed: true }]);
    expect(lineSegments('a b', undefined, undefined)).toEqual([
      { text: 'a b', changed: false },
    ]);
    expect(lineSegments('', [], undefined)).toEqual([]);
  });
});
