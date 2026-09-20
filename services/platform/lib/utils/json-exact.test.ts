import { describe, expect, it } from 'vitest';

import { parseJsonExact } from './json-exact';

describe('parseJsonExact', () => {
  it('parses what JSON.parse parses', () => {
    expect(parseJsonExact('{"a":[1,{"b":"c"}],"n":9007199254740991}')).toEqual({
      exact: true,
      value: { a: [1, { b: 'c' }], n: 9007199254740991 },
    });
  });

  it('names the full path of the first whole number the parser had to round', () => {
    expect(
      parseJsonExact('{"messages":[{"id":1},{"id":9007199254740993}]}'),
    ).toEqual({ exact: false, path: 'messages.1.id' });
    expect(parseJsonExact('{"id":18446744073709551615}')).toEqual({
      exact: false,
      path: 'id',
    });
  });

  it('names the empty path for a bare root literal', () => {
    expect(parseJsonExact('9007199254740993')).toEqual({
      exact: false,
      path: '',
    });
  });

  it('lets an exactly representable big float and a decimal through', () => {
    // 2^60 written with an exponent or a fraction is not a whole-number
    // literal a source system meant as an id; only the plain digits are.
    expect(parseJsonExact('{"x":1e60,"y":9007199254740993.5}').exact).toBe(
      true,
    );
  });

  it('throws what JSON.parse throws for text that is not JSON', () => {
    expect(() => parseJsonExact('{')).toThrow(SyntaxError);
  });
});
