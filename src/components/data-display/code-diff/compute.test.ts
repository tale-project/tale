import { readFileSync } from 'node:fs';
import path from 'node:path';

import { applyPatch, createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff';
import { describe, expect, it } from 'vitest';

import {
  computeLineDiff,
  DIFF_MAX_EDITS,
  diffWords,
  MAX_PATCH_BYTES,
  toUnifiedPatch,
  WORD_DIFF_MAX_CHARS,
  type DiffLine,
} from './compute';

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, at) => `${prefix} ${at + 1}\n`).join(
    '',
  );
}

/** A line as the reader sees it: its sign and its text. */
const shown = (line: DiffLine) =>
  `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}${line.text}`;

describe('computeLineDiff', () => {
  it('lists every line once with its numbers when nothing changed', () => {
    const diff = computeLineDiff('a\nb\n', 'a\nb\n');
    expect(diff.identical).toBe(true);
    expect(diff.hunks).toEqual([]);
    expect(diff.lines).toEqual([
      { kind: 'unchanged', text: 'a', before: 1, after: 1 },
      { kind: 'unchanged', text: 'b', before: 2, after: 2 },
    ]);
  });

  it('numbers each side, puts a change’s removed lines first and marks the word that changed', () => {
    const before = lines(10);
    const after = before.replace('line 5\n', 'line five\n');
    const diff = computeLineDiff(before, after);
    expect(diff).toMatchObject({ added: 1, removed: 1, identical: false });
    expect(diff.lines.slice(3, 7).map(shown)).toEqual([
      ' line 4',
      '-line 5',
      '+line five',
      ' line 6',
    ]);
    expect(diff.lines[4]).toMatchObject({ before: 5 });
    expect(diff.lines[4]?.after).toBeUndefined();
    expect(diff.lines[5]).toMatchObject({ after: 5 });
    expect(diff.lines[4]?.words).toEqual([
      { text: 'line ', changed: false },
      { text: '5', changed: true },
    ]);
    expect(diff.lines[5]?.words).toEqual([
      { text: 'line ', changed: false },
      { text: 'five', changed: true },
    ]);
  });

  it('keeps three unchanged lines round a change, as a patch does', () => {
    const before = lines(20);
    const after = before.replace('line 10\n', 'line ten\n');
    const [hunk] = computeLineDiff(before, after).hunks;
    expect(hunk).toEqual({
      start: 6,
      end: 14,
      before: { start: 7, count: 7 },
      after: { start: 7, count: 7 },
      added: 1,
      removed: 1,
    });
    const tight = computeLineDiff(before, after, { context: 1 }).hunks[0];
    expect(tight).toMatchObject({ start: 8, end: 12 });
  });

  it('never folds away a single line: such a line stays in its hunk', () => {
    const before = lines(30);
    // Seven unchanged lines between the changes: three of context on each
    // side and one between them, so one hunk.
    const close = before
      .replace('line 5\n', 'line five\n')
      .replace('line 13\n', 'line thirteen\n');
    expect(computeLineDiff(before, close).hunks).toHaveLength(1);
    // Eight: two lines between the contexts fold away, so two hunks.
    const apart = before
      .replace('line 5\n', 'line five\n')
      .replace('line 14\n', 'line fourteen\n');
    const hunks = computeLineDiff(before, apart).hunks;
    expect(hunks).toHaveLength(2);
    expect((hunks[1]?.start ?? 0) - (hunks[0]?.end ?? 0)).toBe(2);
    // One line above the first context and one below the last join them.
    const ends = computeLineDiff(lines(9), lines(9).replace('5\n', 'five\n'));
    expect(ends.hunks[0]).toMatchObject({ start: 0, end: 10 });
  });

  it('starts a side a hunk adds nothing to at the line before it', () => {
    const before = lines(10);
    const inserted = before.replace('line 5\n', 'line 5\nnew\n');
    const [hunk] = computeLineDiff(before, inserted).hunks;
    expect(hunk).toMatchObject({
      before: { start: 3, count: 6 },
      after: { start: 3, count: 7 },
      added: 1,
      removed: 0,
    });
    const [onlyAdded] = computeLineDiff('', 'a\nb\n').hunks;
    expect(onlyAdded).toMatchObject({
      before: { start: 0, count: 0 },
      after: { start: 1, count: 2 },
    });
    const [onlyRemoved] = computeLineDiff('a\nb\n', '').hunks;
    expect(onlyRemoved).toMatchObject({
      before: { start: 1, count: 2 },
      after: { start: 0, count: 0 },
    });
  });

  it('pairs a change’s lines in order and leaves the extra ones unpaired', () => {
    const diff = computeLineDiff(
      'keep\nname: a\nmode: x\nkeep 2\n',
      'keep\nname: b\nkeep 2\n',
    );
    expect(diff.lines.map(shown)).toEqual([
      ' keep',
      '-name: a',
      '-mode: x',
      '+name: b',
      ' keep 2',
    ]);
    expect(diff.lines[1]?.words).toBeDefined();
    expect(diff.lines[2]?.words).toBeUndefined();
    expect(diff.lines[3]?.words).toBeDefined();
  });

  it('marks no words when asked not to', () => {
    const before = lines(3);
    const after = before.replace('line 2', 'line two');
    const diff = computeLineDiff(before, after, { words: false });
    expect(diff.lines.every((line) => line.words === undefined)).toBe(true);
  });

  it('reads two texts too far apart as one removed whole and one added whole', () => {
    const before = 'a\nb\nc\nd\n';
    const after = 'w\nb\nx\nd\n';
    const coarse = computeLineDiff(before, after, { maxEditLength: 1 });
    expect(coarse.lines.map(shown)).toEqual([
      '-a',
      '-b',
      '-c',
      '-d',
      '+w',
      '+b',
      '+x',
      '+d',
    ]);
    expect(coarse).toMatchObject({ added: 4, removed: 4 });
    // Lines paired only by position share nothing worth marking.
    expect(coarse.lines.every((each) => each.words === undefined)).toBe(true);
    expect(computeLineDiff(before, after).added).toBe(2);
  });

  it('gives up past its edit bound fast, on texts of a whole document', () => {
    const before = lines(9_000, 'a');
    const after = lines(9_000, 'b');
    const started = performance.now();
    const diff = computeLineDiff(before, after);
    // The bound keeps the search to about half a second on a fast machine.
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(diff).toMatchObject({ added: 9_000, removed: 9_000 });
  });

  it('reads a last line without a line break as a line', () => {
    const diff = computeLineDiff('a\nb', 'a\nc');
    expect(diff.lines.map(shown)).toEqual([' a', '-b', '+c']);
  });
});

describe('diffWords', () => {
  it('marks the runs that changed on each side, spaces included', () => {
    expect(diffWords('model: claude-haiku', 'model:  claude-sonnet')).toEqual({
      before: [
        { text: 'model:', changed: false },
        { text: ' ', changed: true },
        { text: 'claude-', changed: false },
        { text: 'haiku', changed: true },
      ],
      after: [
        { text: 'model:', changed: false },
        { text: '  ', changed: true },
        { text: 'claude-', changed: false },
        { text: 'sonnet', changed: true },
      ],
    });
  });

  it('marks nothing between lines that share no word, are equal, or are too long', () => {
    expect(diffWords('alpha beta', 'gamma delta')).toBeNull();
    expect(diffWords('same', 'same')).toBeNull();
    const long = 'x '.repeat(WORD_DIFF_MAX_CHARS);
    expect(diffWords(long, `${long}y`)).toBeNull();
  });
});

describe('toUnifiedPatch', () => {
  const LABELS = { from: 'v4', to: 'v5' };

  it('writes the file headers and hunks git reads', () => {
    const before = lines(10);
    const after = before.replace('line 5\n', 'line five\n');
    expect(toUnifiedPatch(before, after, LABELS)).toEqual({
      patch: [
        '--- v4',
        '+++ v5',
        '@@ -2,7 +2,7 @@',
        ' line 2',
        ' line 3',
        ' line 4',
        '-line 5',
        '+line five',
        ' line 6',
        ' line 7',
        ' line 8',
        '',
      ].join('\n'),
      truncated: false,
    });
  });

  it('is jsdiff’s two-file patch with file headers only, byte for byte', () => {
    const before = lines(60);
    const after = before
      .replace('line 3\n', 'line three\n')
      .replace('line 40\n', '')
      .concat('line 61\n');
    expect(toUnifiedPatch(before, after, { ...LABELS, context: 2 }).patch).toBe(
      createTwoFilesPatch('v4', 'v5', before, after, undefined, undefined, {
        context: 2,
        headerOptions: FILE_HEADERS_ONLY,
      }),
    );
    const { patch } = toUnifiedPatch(before, after, LABELS);
    expect(applyPatch(before, patch)).toBe(after);
  });

  it('replaces the whole text in one hunk past its edit bound, as jsdiff writes it', () => {
    const half = DIFF_MAX_EDITS / 2 + 50;
    const before = lines(half, 'old');
    // The newer text has no final line break.
    const after = lines(half, 'new').slice(0, -1);
    const options = { ...LABELS, maxBytes: Number.POSITIVE_INFINITY };
    const { patch } = toUnifiedPatch(before, after, options);
    expect(patch.split('\n')[2]).toBe(`@@ -1,${half} +1,${half} @@`);
    expect(patch).toBe(
      createTwoFilesPatch('v4', 'v5', before, after, undefined, undefined, {
        context: 3,
        headerOptions: FILE_HEADERS_ONLY,
      }),
    );
    expect(applyPatch(before, patch)).toBe(after);
    // A text out of nothing.
    const created = lines(DIFF_MAX_EDITS + 10, 'new');
    const fromNothing = toUnifiedPatch('', created, options).patch;
    expect(fromNothing.split('\n')[2]).toBe(
      `@@ -0,0 +1,${DIFF_MAX_EDITS + 10} @@`,
    );
    expect(applyPatch('', fromNothing)).toBe(created);
  });

  it('has no patch for two equal texts', () => {
    expect(toUnifiedPatch('a\n', 'a\n', LABELS)).toEqual({
      patch: '',
      truncated: false,
    });
  });

  it('cuts a patch past its size at the last whole line that fits', () => {
    const before = lines(400, 'old 😀');
    const after = lines(400, 'new 😀');
    const whole = toUnifiedPatch(before, after, LABELS).patch;
    const maxBytes = 1_000;
    const { patch, truncated } = toUnifiedPatch(before, after, {
      ...LABELS,
      maxBytes,
    });
    expect(truncated).toBe(true);
    expect(new TextEncoder().encode(patch).length).toBeLessThanOrEqual(
      maxBytes,
    );
    expect(patch.endsWith('\n')).toBe(true);
    expect(whole.startsWith(patch)).toBe(true);
    const next = whole.slice(
      patch.length,
      whole.indexOf('\n', patch.length) + 1,
    );
    expect(new TextEncoder().encode(patch + next).length).toBeGreaterThan(
      maxBytes,
    );
  });

  it('answers a whole patch up to the default size, and any size when asked', () => {
    expect(MAX_PATCH_BYTES).toBe(262_144);
    expect(
      toUnifiedPatch(lines(500), lines(500, 'changed'), LABELS).truncated,
    ).toBe(false);
    const big = lines(1_500, 'a'.repeat(200));
    const other = lines(1_500, 'b'.repeat(200));
    expect(toUnifiedPatch(big, other, LABELS).truncated).toBe(true);
    expect(
      toUnifiedPatch(big, other, { ...LABELS, maxBytes: Infinity }).truncated,
    ).toBe(false);
  });
});

describe('the compute module', () => {
  it('imports jsdiff alone, so the engine can run it on the server', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, 'compute.ts'),
      'utf8',
    );
    const specifiers = [
      ...source.matchAll(
        /(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g,
      ),
      ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);
    expect(specifiers).toEqual(['diff']);
  });
});
