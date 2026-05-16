import { describe, expect, test } from 'vitest';

import { buildHunks, HUNK_CONTEXT_LINES, type Hunk } from './build-hunks';

const PATCH = (search: string, replace: string) => ({ search, replace });

function expectSinglePatchHunk(
  hunk: Hunk,
  expected: {
    startLine: number;
    endLine: number;
    before: string;
    search: string;
    replace: string;
    after: string;
  },
) {
  expect(hunk.startLine).toBe(expected.startLine);
  expect(hunk.endLine).toBe(expected.endLine);
  // Hunks always emit context-patch-context for a single patch group.
  expect(hunk.segments).toHaveLength(3);
  const [before, patch, after] = hunk.segments;
  expect(before).toEqual({ kind: 'context', text: expected.before });
  expect(patch).toEqual({
    kind: 'patch',
    search: expected.search,
    replace: expected.replace,
  });
  expect(after).toEqual({ kind: 'context', text: expected.after });
}

describe('buildHunks', () => {
  test('returns empty array when no patches', () => {
    expect(buildHunks('any code', [])).toEqual([]);
  });

  test('returns empty array when only no-op / unmatched patches', () => {
    const code = 'a\nb\nc';
    expect(buildHunks(code, [PATCH('', 'X')])).toEqual([]);
    expect(buildHunks(code, [PATCH('Z', 'Y')])).toEqual([]);
  });

  test('single-line patch in middle of file emits ±3 line context', () => {
    const code = 'l1\nl2\nl3\nl4\nl5\nl6\nl7';
    const hunks = buildHunks(code, [PATCH('l4', 'XX')]);
    expect(hunks).toHaveLength(1);
    expectSinglePatchHunk(hunks[0], {
      startLine: 1,
      endLine: 7,
      before: 'l1\nl2\nl3\n',
      search: 'l4',
      replace: 'XX',
      after: '\nl5\nl6\nl7',
    });
  });

  test('multi-line search spans correct startLine/endLine', () => {
    const code = 'l1\nl2\nl3\nl4\nl5\nl6';
    const hunks = buildHunks(code, [PATCH('l3\nl4', 'X\nY')]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].startLine).toBe(1);
    expect(hunks[0].endLine).toBe(6);
    const patchSeg = hunks[0].segments.find((s) => s.kind === 'patch');
    expect(patchSeg).toEqual({
      kind: 'patch',
      search: 'l3\nl4',
      replace: 'X\nY',
    });
  });

  test('patch on the first line has empty leading context', () => {
    const code = 'l1\nl2\nl3\nl4';
    const hunks = buildHunks(code, [PATCH('l1', 'NEW')]);
    expect(hunks).toHaveLength(1);
    expectSinglePatchHunk(hunks[0], {
      startLine: 1,
      endLine: 4,
      before: '',
      search: 'l1',
      replace: 'NEW',
      after: '\nl2\nl3\nl4',
    });
  });

  test('patch on the last line (no trailing newline) has empty trailing context', () => {
    const code = 'l1\nl2\nl3';
    const hunks = buildHunks(code, [PATCH('l3', 'NEW')]);
    expect(hunks).toHaveLength(1);
    expectSinglePatchHunk(hunks[0], {
      startLine: 1,
      endLine: 3,
      before: 'l1\nl2\n',
      search: 'l3',
      replace: 'NEW',
      after: '',
    });
  });

  test('two patches far apart produce two separate hunks', () => {
    // 20 lines; patch at line 3 and line 17 — contexts are far apart.
    const code = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join(
      '\n',
    );
    const hunks = buildHunks(code, [
      PATCH('line3', 'X3'),
      PATCH('line17', 'X17'),
    ]);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].startLine).toBe(1);
    expect(hunks[0].endLine).toBe(6);
    expect(hunks[1].startLine).toBe(14);
    expect(hunks[1].endLine).toBe(20);
  });

  test('two patches with touching contexts merge into one hunk', () => {
    // 10 lines; patch at line 3 and line 7 → context windows [1..6] and [4..10] touch.
    const code = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join(
      '\n',
    );
    const hunks = buildHunks(code, [
      PATCH('line3', 'X3'),
      PATCH('line7', 'X7'),
    ]);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0];
    expect(hunk.startLine).toBe(1);
    expect(hunk.endLine).toBe(10);
    // Expected segment shape: ctx, patch, ctx, patch, ctx
    expect(hunk.segments.map((s) => s.kind)).toEqual([
      'context',
      'patch',
      'context',
      'patch',
      'context',
    ]);
    const patches = hunk.segments.filter((s) => s.kind === 'patch');
    expect(patches).toEqual([
      { kind: 'patch', search: 'line3', replace: 'X3' },
      { kind: 'patch', search: 'line7', replace: 'X7' },
    ]);
  });

  test('two patches with overlapping match ranges resolve first-write-wins', () => {
    const code = 'abcdef';
    // Both target overlapping char ranges. First wins.
    const hunks = buildHunks(code, [PATCH('bcd', 'XYZ'), PATCH('cde', 'NOPE')]);
    expect(hunks).toHaveLength(1);
    const patches = hunks[0].segments.filter((s) => s.kind === 'patch');
    expect(patches).toEqual([{ kind: 'patch', search: 'bcd', replace: 'XYZ' }]);
  });

  test('empty replace (mid-stream) preserves the empty string', () => {
    const code = 'l1\nl2\nl3\nl4';
    const hunks = buildHunks(code, [PATCH('l2', '')]);
    expect(hunks).toHaveLength(1);
    const patch = hunks[0].segments.find((s) => s.kind === 'patch');
    expect(patch).toEqual({ kind: 'patch', search: 'l2', replace: '' });
  });

  test('CRLF line endings: \\r is part of the preceding line content', () => {
    const code = 'a\r\nb\r\nc\r\nd';
    // line 1 = "a\r", line 2 = "b\r", line 3 = "c\r", line 4 = "d".
    const hunks = buildHunks(code, [PATCH('c', 'C')]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].startLine).toBe(1);
    expect(hunks[0].endLine).toBe(4);
    expectSinglePatchHunk(hunks[0], {
      startLine: 1,
      endLine: 4,
      before: 'a\r\nb\r\n',
      search: 'c',
      replace: 'C',
      after: '\r\nd',
    });
  });

  test('surrogate pair inside search is matched correctly', () => {
    // 😀 is U+1F600 = surrogate pair "😀".
    const code = 'before 😀 mid 😀 end';
    const hunks = buildHunks(code, [PATCH('😀', '🌟')]);
    expect(hunks).toHaveLength(1);
    const patches = hunks[0].segments.filter((s) => s.kind === 'patch');
    // First-write-wins on the first match only.
    expect(patches).toEqual([{ kind: 'patch', search: '😀', replace: '🌟' }]);
    // Trailing context after the FIRST 😀 should include the rest verbatim.
    const trailing = hunks[0].segments[hunks[0].segments.length - 1];
    expect(trailing.kind).toBe('context');
    if (trailing.kind === 'context') {
      expect(trailing.text).toBe(' mid 😀 end');
    }
  });

  test('contextLines = 0 yields no surrounding context', () => {
    const code = 'l1\nl2\nl3\nl4\nl5';
    const hunks = buildHunks(code, [PATCH('l3', 'X')], 0);
    expect(hunks).toHaveLength(1);
    expectSinglePatchHunk(hunks[0], {
      startLine: 3,
      endLine: 3,
      before: '',
      search: 'l3',
      replace: 'X',
      after: '',
    });
  });

  test('default contextLines is HUNK_CONTEXT_LINES', () => {
    expect(HUNK_CONTEXT_LINES).toBe(3);
    const code = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join(
      '\n',
    );
    const hunks = buildHunks(code, [PATCH('line15', 'X')]);
    expect(hunks).toHaveLength(1);
    // ±3 lines around line 15 → lines 12..18.
    expect(hunks[0].startLine).toBe(12);
    expect(hunks[0].endLine).toBe(18);
  });

  test('1MB synthetic input × 5 patches completes well under 50ms', () => {
    // Build ~1MB of code: 50_000 lines × 20-char line.
    const lines = Array.from(
      { length: 50_000 },
      (_, i) => `// line ${i.toString().padStart(10, '0')}`,
    );
    const code = lines.join('\n');
    const patches = [
      PATCH('// line 0000000100', 'X100'),
      PATCH('// line 0000010000', 'X10k'),
      PATCH('// line 0000020000', 'X20k'),
      PATCH('// line 0000030000', 'X30k'),
      PATCH('// line 0000049000', 'X49k'),
    ];

    const start = performance.now();
    const hunks = buildHunks(code, patches);
    const elapsed = performance.now() - start;

    expect(hunks).toHaveLength(5);
    expect(elapsed).toBeLessThan(50);
  });
});
