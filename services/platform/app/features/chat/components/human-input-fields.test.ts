import { describe, expect, it } from 'vitest';

import { countFilledTodoRows, parseTodoList } from './human-input-fields';

describe('parseTodoList', () => {
  it('returns null for empty or malformed input', () => {
    expect(parseTodoList('')).toBeNull();
    expect(parseTodoList('not json')).toBeNull();
    expect(parseTodoList('{"id":"a"}')).toBeNull();
  });

  it('keeps only well-formed rows', () => {
    const raw = JSON.stringify([
      { id: 'a', content: 'first' },
      { id: 'b' },
      { content: 'no id' },
      { id: 'c', content: '' },
    ]);
    expect(parseTodoList(raw)).toEqual([
      { id: 'a', content: 'first' },
      { id: 'c', content: '' },
    ]);
  });
});

describe('countFilledTodoRows (#2079)', () => {
  it('returns 0 when every seeded row is blank or whitespace', () => {
    // The input seeds a row and serializes via JSON.stringify, so an
    // untouched required field arrives as a non-empty string of blank rows.
    expect(
      countFilledTodoRows(JSON.stringify([{ id: 'a', content: '' }])),
    ).toBe(0);
    expect(
      countFilledTodoRows(
        JSON.stringify([
          { id: 'a', content: '   ' },
          { id: 'b', content: '\n\t' },
        ]),
      ),
    ).toBe(0);
  });

  it('counts only rows carrying real content', () => {
    expect(
      countFilledTodoRows(
        JSON.stringify([
          { id: 'a', content: 'one' },
          { id: 'b', content: '  ' },
          { id: 'c', content: 'two' },
        ]),
      ),
    ).toBe(2);
  });

  it('returns 0 for empty or invalid serialized values', () => {
    expect(countFilledTodoRows('')).toBe(0);
    expect(countFilledTodoRows('garbage')).toBe(0);
  });
});
