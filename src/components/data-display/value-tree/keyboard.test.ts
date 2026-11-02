import { describe, expect, it } from 'vitest';

import { treeKeyAction, typeaheadMatch, type TreeKeyInput } from './keyboard';
import { flattenValue, type ValueTreeRow } from './model';

const VALUE = {
  alpha: 1,
  author: { name: 'Ada', id: 7 },
  body: 'x'.repeat(300),
  beta: [1, 2],
  gamma: { a: 1 },
};

const STATE = {
  textOpen: new Set<string>(),
  isLongText: (row: ValueTreeRow) =>
    row.type === 'node' &&
    typeof row.value === 'string' &&
    row.value.length > 240,
  copyable: true,
};

function key(name: string, modifiers: Partial<TreeKeyInput> = {}) {
  return {
    key: name,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...modifiers,
  };
}

describe('treeKeyAction', () => {
  const closed = flattenValue(VALUE);
  const open = flattenValue(VALUE, {
    expanded: new Map([['/author', true]]),
  });

  it('moves with the arrows and jumps with Home and End', () => {
    expect(treeKeyAction(key('ArrowDown'), closed, 0, STATE)).toEqual({
      type: 'focus',
      index: 1,
    });
    expect(treeKeyAction(key('ArrowDown'), closed, 4, STATE)).toEqual({
      type: 'focus',
      index: 4,
    });
    expect(treeKeyAction(key('ArrowUp'), closed, 0, STATE)).toEqual({
      type: 'focus',
      index: 0,
    });
    expect(treeKeyAction(key('End'), closed, 1, STATE)).toEqual({
      type: 'focus',
      index: 4,
    });
    expect(treeKeyAction(key('Home'), closed, 3, STATE)).toEqual({
      type: 'focus',
      index: 0,
    });
  });

  it('opens a container with →, then steps into it', () => {
    expect(treeKeyAction(key('ArrowRight'), closed, 1, STATE)).toEqual({
      type: 'open',
      id: '/author',
    });
    expect(treeKeyAction(key('ArrowRight'), open, 1, STATE)).toEqual({
      type: 'focus',
      index: 2,
    });
  });

  it('closes a container with ←, and steps out to the parent from a child', () => {
    expect(treeKeyAction(key('ArrowLeft'), open, 1, STATE)).toEqual({
      type: 'close',
      id: '/author',
    });
    expect(treeKeyAction(key('ArrowLeft'), open, 3, STATE)).toEqual({
      type: 'focus',
      index: 1,
    });
    expect(treeKeyAction(key('ArrowLeft'), closed, 0, STATE)).toBeNull();
  });

  it('shows long text whole with → and cuts it again with ←', () => {
    const body = closed.findIndex((row) => row.id === '/body');
    expect(treeKeyAction(key('ArrowRight'), closed, body, STATE)).toEqual({
      type: 'openText',
      id: '/body',
    });
    expect(
      treeKeyAction(key('ArrowLeft'), closed, body, {
        ...STATE,
        textOpen: new Set(['/body']),
      }),
    ).toEqual({ type: 'closeText', id: '/body' });
  });

  it('opens every closed sibling container with *', () => {
    expect(treeKeyAction(key('*'), closed, 0, STATE)).toEqual({
      type: 'openSiblings',
      ids: ['/author', '/beta', '/gamma'],
    });
  });

  it('activates with Enter and copies with ⌘/Ctrl+C and ⇧⌘/Ctrl+C', () => {
    expect(treeKeyAction(key('Enter'), closed, 2, STATE)).toEqual({
      type: 'activate',
      index: 2,
    });
    expect(
      treeKeyAction(key('c', { metaKey: true }), closed, 0, STATE),
    ).toEqual({ type: 'copy', what: 'value' });
    expect(
      treeKeyAction(
        key('C', { ctrlKey: true, shiftKey: true }),
        closed,
        0,
        STATE,
      ),
    ).toEqual({ type: 'copy', what: 'path' });
    expect(
      treeKeyAction(key('c', { metaKey: true }), closed, 0, {
        ...STATE,
        copyable: false,
      }),
    ).toBeNull();
  });

  it('hands printable characters to type-ahead and ignores the rest', () => {
    expect(treeKeyAction(key('g'), closed, 0, STATE)).toEqual({
      type: 'type',
      char: 'g',
    });
    expect(treeKeyAction(key(' '), closed, 0, STATE)).toBeNull();
    expect(treeKeyAction(key('Tab'), closed, 0, STATE)).toBeNull();
    expect(
      treeKeyAction(key('a', { altKey: true }), closed, 0, STATE),
    ).toBeNull();
  });
});

describe('typeaheadMatch', () => {
  const rows = flattenValue(VALUE);

  it('lands on the next key that starts with what was typed', () => {
    expect(typeaheadMatch(rows, 0, 'b')).toBe(2);
    expect(typeaheadMatch(rows, 0, 'be')).toBe(3);
    expect(typeaheadMatch(rows, 0, 'G')).toBe(4);
    expect(typeaheadMatch(rows, 0, 'z')).toBeNull();
  });

  it('steps through the keys of one repeated character, wrapping', () => {
    expect(typeaheadMatch(rows, 0, 'a')).toBe(1);
    expect(typeaheadMatch(rows, 1, 'aa')).toBe(0);
  });

  it('keeps the row it is on while the typed word still matches it', () => {
    expect(typeaheadMatch(rows, 1, 'au')).toBe(1);
  });
});
