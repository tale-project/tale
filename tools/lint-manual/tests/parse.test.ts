import { describe, expect, test } from 'bun:test';

import { backtickedTokens, linkTargets, parseSuite } from '../src/parse';

describe('parse', () => {
  test('reads the prefix declaration and every box', () => {
    const suite = parseSuite(
      'smoke.md',
      'p/smoke.md',
      [
        '# Smoke',
        '',
        '> **Prefix** `A-` `B-` · **Reset** none · **Cost** 1m',
        '',
        '## Group',
        '',
        '- [ ] `A-1` · **Do it** → it happened.',
        '- [x] `B-2` · **Do it again** → it happened twice.',
      ].join('\n'),
    );
    expect(suite.prefixes).toEqual(['A-', 'B-']);
    expect(suite.prefixLine).toBe(3);
    expect(suite.headings).toEqual(['Smoke', 'Group']);
    expect(suite.boxes.map((b) => [b.id, b.line, b.ticked])).toEqual([
      ['A-1', 7, false],
      ['B-2', 8, true],
    ]);
  });

  test('folds continuation lines into the box body', () => {
    const suite = parseSuite(
      's.md',
      'p/s.md',
      '- [ ] `A-1` · **Do the thing\n  across lines** → it\n  holds.\n',
    );
    expect(suite.boxes[0].body).toBe(
      '**Do the thing across lines** → it holds.',
    );
  });

  test('a checkbox that is not a box is malformed, not ignored', () => {
    const suite = parseSuite('s.md', 'p/s.md', '- [ ] no id\n');
    expect(suite.boxes).toEqual([]);
    expect(suite.malformed).toEqual([{ line: 1, text: '- [ ] no id' }]);
  });

  test('a link inside backticks is an example, not a link', () => {
    expect(linkTargets('see [real](a.md) and `[example](b.md)`')).toEqual([
      'a.md',
    ]);
  });

  test('a link inside a fence is an example too', () => {
    expect(linkTargets('```\n[x](fenced.md)\n```\n[y](real.md)')).toEqual([
      'real.md',
    ]);
  });

  test('backticked tokens are deduplicated in order', () => {
    expect(backtickedTokens('`a` then `b` then `a`')).toEqual(['a', 'b']);
  });
});
