// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { parseBody, parseExpressionIn } from './parse';

const parse = (text: string) => parseExpressionIn(text, 0, text.length);

describe('parseExpressionIn', () => {
  it.each(['a', '(a)', '((a))', '(a) + (b)', '({ ...nodes })', 'a /* note */'])(
    'accepts %s as exactly one expression',
    (text) => {
      expect(parse(text)).toMatchObject({
        ok: true,
        start: 0,
        end: text.length,
      });
    },
  );

  it('parses in place: positions are offsets in the field string', () => {
    const field = 'Hi {{ nodes.a.output }}!';
    const result = parseExpressionIn(field, 6, 20);
    expect(result.ok).toBe(true);
    expect(result.ok && result.ast.range).toEqual([6, 20]);
  });

  it('refuses trailing tokens at the first extra one', () => {
    expect(parse('a b')).toEqual({
      ok: false,
      message: 'Unexpected token',
      range: [2, 3],
    });
    expect(parse('(a))')).toMatchObject({ ok: false, range: [3, 4] });
  });

  it('refuses a trailing line comment, which would swallow the wrapper', () => {
    expect(parse('a // note')).toMatchObject({ ok: false, range: [1, 9] });
    expect(parse('a // note\n + b')).toMatchObject({ ok: true });
  });

  it("reports acorn's sentence without its (line:col) suffix, inside the span", () => {
    const result = parseExpressionIn('{{ input. }}', 3, 9);
    expect(result).toEqual({
      ok: false,
      message: 'Unexpected token',
      range: [8, 9],
    });
  });
});

describe('parseBody', () => {
  it('allows a top-level return, like the runner wrapper', () => {
    expect(parseBody('const a = 1;\nreturn a;')).toMatchObject({ ok: true });
  });

  it('locates a syntax error', () => {
    expect(parseBody('return (;')).toMatchObject({
      ok: false,
      range: [8, 9],
    });
  });
});
