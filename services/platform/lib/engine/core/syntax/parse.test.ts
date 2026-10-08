// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBody, parseExpressionIn, RUNTIME_ECMA_VERSION } from './parse';

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

describe('the language the runtime speaks', () => {
  it.each([
    ['regular-expression modifiers', '/(?i:a)/.test(input.s)'],
    ['duplicate named groups', '/(?<y>a)|(?<y>b)/.test(input.s)'],
  ])('refuses %s, which Node 22 does not run', (_, text) => {
    expect(parse(text).ok).toBe(false);
  });

  it('refuses a using declaration in a transform body', () => {
    expect(parseBody('using x = null;\nreturn 1;').ok).toBe(false);
  });

  it('accepts what Node 22 runs', () => {
    expect(parse('/[\\p{L}--[a-z]]/v.test(input.s)').ok).toBe(true);
    expect(parse('Object.groupBy(input.xs, (x) => x.kind)').ok).toBe(true);
  });

  it("follows the runtime image's Node", () => {
    // Raise RUNTIME_ECMA_VERSION with the Node the platform image runs:
    // Node 22 speaks ES2024; ES2025's regular-expression syntax needs 24.
    const dockerfile = readFileSync(
      fileURLToPath(new URL('../../../../Dockerfile', import.meta.url)),
      'utf8',
    );
    const major = /^FROM node:(\d+)\./m.exec(dockerfile)?.[1];
    expect({ major, ecma: RUNTIME_ECMA_VERSION }).toEqual({
      major: '22',
      ecma: 2024,
    });
  });
});
