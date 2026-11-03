import { describe, expect, it } from 'vitest';

import {
  SESSION_NAME_MAX_LENGTH,
  hasControlCharacter,
  nameLength,
} from './session-name.ts';

describe('SESSION_NAME_MAX_LENGTH', () => {
  it('is the limit the server holds a session name to', () => {
    expect(SESSION_NAME_MAX_LENGTH).toBe(80);
  });
});

describe('nameLength', () => {
  it('counts the characters of a name', () => {
    expect(nameLength('Shop')).toBe(4);
    expect(nameLength('')).toBe(0);
  });

  it('counts an emoji as one character, as a person does', () => {
    // Two UTF-16 units each.
    expect(nameLength('😀'.repeat(60))).toBe(60);
    expect('😀'.repeat(60)).toHaveLength(120);
  });
});

describe('hasControlCharacter', () => {
  it.each([
    ['NUL', '\u0000'],
    ['a tab', '\t'],
    ['a line feed', '\n'],
    ['a carriage return', '\r'],
    ['an escape', '\u001b'],
    ['the last of C0', '\u001f'],
    ['DEL', '\u007f'],
    ['the first of C1', '\u0080'],
    ['a next line', '\u0085'],
    ['the last of C1', '\u009f'],
    ['a line separator', '\u2028'],
    ['a paragraph separator', '\u2029'],
  ])('finds %s inside a name', (_what, character) => {
    expect(hasControlCharacter(`a${character}b`)).toBe(true);
    expect(hasControlCharacter(character)).toBe(true);
  });

  it.each([
    'Shop',
    'Work Browser',
    'a b',
    'Zoë',
    'Café Müller',
    '日本語',
    '😀'.repeat(80),
    '👨‍👩‍👧',
    'a\u00a0b', // a no-break space is a space, not a control character
    'a\u200bb',
    '',
  ])('does not find one in %j', (name) => {
    expect(hasControlCharacter(name)).toBe(false);
  });
});
