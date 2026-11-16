import { describe, expect, it } from 'vitest';

import { lexIcu } from './icu-lexer';

function placeholders(value: string): string[] {
  return [...lexIcu(value).placeholders];
}

function plurals(value: string) {
  return lexIcu(value).plurals.map((plural) => ({
    name: plural.name,
    kind: plural.kind,
    categories: [...plural.categories],
  }));
}

describe('lexIcu', () => {
  it('reads the arguments of every branch, at any depth', () => {
    expect(
      placeholders(
        '{a} {n, plural, one {# by {b}} other {{c, number} by {b}}} {s, select, x {{d}} other {}}',
      ),
    ).toEqual(['a', 'n', 'b', 'c', 's', 'd']);
  });

  it('reads number, date and time arguments without their style', () => {
    expect(
      placeholders(
        '{price, number, ::currency/EUR} on {day, date, short} at {t, time}',
      ),
    ).toEqual(['price', 'day', 't']);
  });

  it('takes quoted text for text, as the formatter does', () => {
    // `'{a}'` and `'{'` quote braces, `''` is an apostrophe, and a lone
    // `'` quotes nothing.
    expect(placeholders("'{a}' {b} it''s '{'{c}'}' l'objet {d}")).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it("quotes after # in a plural branch only: in a select branch, ' is an apostrophe", () => {
    expect(placeholders("{n, plural, other {'#{x}' items}}")).toEqual(['n']);
    expect(placeholders("{s, select, other {'#{x}' items}}")).toEqual([
      's',
      'x',
    ]);
    expect(placeholders("'#{x}'")).toEqual(['x']);
  });

  it('lists every plural with its selectors, nested ones included', () => {
    expect(
      plurals(
        '{s, select, a {{n, plural, =0 {none} one {one} other {#}}} other {{m, selectordinal, one {#st} other {#th}}}}',
      ),
    ).toEqual([
      { name: 'n', kind: 'plural', categories: ['=0', 'one', 'other'] },
      { name: 'm', kind: 'selectordinal', categories: ['one', 'other'] },
    ]);
    expect(
      lexIcu('{s, select, a {{n, plural, other {#}}} other {}}'),
    ).toMatchObject({
      hasPlural: true,
      hasSelect: true,
      hasSelectOrdinal: false,
    });
  });

  it('skips the offset of a plural', () => {
    expect(
      plurals('{n, plural, offset:1 =0 {nobody} one {you} other {you and #}}'),
    ).toEqual([
      { name: 'n', kind: 'plural', categories: ['=0', 'one', 'other'] },
    ]);
  });

  it('reads white space and line breaks between the parts of an argument', () => {
    expect(plurals('{ n ,\n  plural ,\n  one { # }\n  other { # }\n}')).toEqual(
      [{ name: 'n', kind: 'plural', categories: ['one', 'other'] }],
    );
  });

  it('reads a } outside any argument as text', () => {
    expect(placeholders('a } b {c}')).toEqual(['c']);
  });

  it('reads what it can of malformed input, and never throws', () => {
    expect(placeholders('{a} {b')).toEqual(['a', 'b']);
    for (const value of [
      '{',
      '}',
      "'{",
      '{n, plural, one {',
      '{n, plural,, one {a} other {b}}',
      '{, x}',
      '{n, select, {a} other {b}}',
    ]) {
      expect(() => lexIcu(value)).not.toThrow();
    }
  });
});
