// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { foldConstant } from './constant';
import { parseExpressionIn } from './parse';

function fold(expr: string): ReturnType<typeof foldConstant> {
  const parsed = parseExpressionIn(expr, 0, expr.length);
  if (!parsed.ok) throw new Error(parsed.message);
  return foldConstant(parsed.ast);
}

describe('foldConstant', () => {
  it.each([
    ['true', true],
    ['!0', true],
    ['1 > 2', false],
    ["'a' + 1", 'a1'],
    ['`text`', 'text'],
    ['[1, [2]]', [1, [2]]],
    ['{a: 1, "b": [true]}', { a: 1, b: [true] }],
    ['null ?? 3', 3],
    ['0 || "x"', 'x'],
    ['1 ? "y" : "n"', 'y'],
    ['typeof undefined', 'undefined'],
    ['-(2 ** 3)', -8],
    ['void 0', undefined],
  ] as const)('%s → %j', (expr, value) => {
    expect(fold(expr)).toEqual({ ok: true, value });
  });

  it.each([
    'input.go',
    'nodes.a.output',
    'Date.now()',
    'x => 1',
    '[...xs]',
    '{ [k]: 1 }',
    '/re/',
    '"a" in {}',
    'item',
  ])('%s is not constant', (expr) => {
    expect(fold(expr)).toEqual({ ok: false });
  });
});
