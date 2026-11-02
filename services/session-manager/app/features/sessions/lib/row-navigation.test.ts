import { afterEach, describe, expect, it } from 'vitest';

import { adjacentRow, rowFocusIndex, rowLinks } from './row-navigation';

afterEach(() => {
  document.body.replaceChildren();
});

/** A list of row links, `open` of them being the current page. */
function listOf(keys: readonly string[], open?: string): HTMLElement {
  const root = document.createElement('div');
  const list = document.createElement('ul');
  for (const key of keys) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/sessions/${key}`;
    link.dataset.indicatorKey = key;
    if (key === open) link.setAttribute('aria-current', 'page');
    // The buttons beside a row are not rows.
    const menu = document.createElement('button');
    menu.dataset.indicatorKey = `menu-${key}`;
    item.append(link, menu);
    list.append(item);
  }
  root.append(list);
  document.body.append(root);
  return root;
}

interface KeyInit {
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
}

function keyDown(
  key: string,
  init: Partial<KeyInit> = {},
  target: EventTarget = document.body,
) {
  return {
    key,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target,
    ...init,
  };
}

describe('rowLinks', () => {
  it('finds the links of the rows in reading order, and not the buttons beside them', () => {
    const root = listOf(['3', '2', '1']);
    expect(rowLinks(root).map((link) => link.dataset.indicatorKey)).toEqual([
      '3',
      '2',
      '1',
    ]);
  });
});

describe('rowFocusIndex', () => {
  it('moves one row with the arrow keys', () => {
    expect(rowFocusIndex(keyDown('ArrowDown'), 1, 4)).toBe(2);
    expect(rowFocusIndex(keyDown('ArrowUp'), 1, 4)).toBe(0);
  });

  it('goes to the first and the last row with Home and End', () => {
    expect(rowFocusIndex(keyDown('Home'), 2, 4)).toBe(0);
    expect(rowFocusIndex(keyDown('End'), 1, 4)).toBe(3);
  });

  it('stays where it is at the ends, and for any other key', () => {
    expect(rowFocusIndex(keyDown('ArrowUp'), 0, 4)).toBeNull();
    expect(rowFocusIndex(keyDown('ArrowDown'), 3, 4)).toBeNull();
    expect(rowFocusIndex(keyDown('a'), 1, 4)).toBeNull();
    expect(rowFocusIndex(keyDown('ArrowDown'), -1, 4)).toBeNull();
  });

  it('leaves the keys with a modifier to whoever owns them', () => {
    for (const modifier of [
      'altKey',
      'metaKey',
      'ctrlKey',
      'shiftKey',
    ] as const) {
      expect(
        rowFocusIndex(keyDown('ArrowDown', { [modifier]: true }), 1, 4),
      ).toBeNull();
    }
  });
});

describe('adjacentRow', () => {
  it('leads from the open row to the next one with Alt and Down, and the previous with Alt and Up', () => {
    const root = listOf(['3', '2', '1'], '2');
    expect(
      adjacentRow(keyDown('ArrowDown', { altKey: true }), root)?.dataset
        .indicatorKey,
    ).toBe('1');
    expect(
      adjacentRow(keyDown('ArrowUp', { altKey: true }), root)?.dataset
        .indicatorKey,
    ).toBe('3');
  });

  it('has nowhere to go past the first and the last row', () => {
    const root = listOf(['3', '2', '1'], '3');
    expect(adjacentRow(keyDown('ArrowUp', { altKey: true }), root)).toBeNull();
    const last = listOf(['3', '2', '1'], '1');
    expect(
      adjacentRow(keyDown('ArrowDown', { altKey: true }), last),
    ).toBeNull();
  });

  it('starts at the first row going down and the last going up when none is open', () => {
    const root = listOf(['3', '2', '1']);
    expect(
      adjacentRow(keyDown('ArrowDown', { altKey: true }), root)?.dataset
        .indicatorKey,
    ).toBe('3');
    expect(
      adjacentRow(keyDown('ArrowUp', { altKey: true }), root)?.dataset
        .indicatorKey,
    ).toBe('1');
  });

  it('answers only to Alt with an arrow, and nothing else', () => {
    const root = listOf(['3', '2', '1'], '2');
    expect(adjacentRow(keyDown('ArrowDown'), root)).toBeNull();
    expect(adjacentRow(keyDown('Enter', { altKey: true }), root)).toBeNull();
    expect(
      adjacentRow(keyDown('ArrowDown', { altKey: true, shiftKey: true }), root),
    ).toBeNull();
    expect(
      adjacentRow(keyDown('ArrowDown', { altKey: true, metaKey: true }), root),
    ).toBeNull();
    expect(
      adjacentRow(
        keyDown('ArrowDown', { altKey: true, defaultPrevented: true }),
        root,
      ),
    ).toBeNull();
  });

  it('leaves the keys to a text field, whose cursor they move', () => {
    const root = listOf(['3', '2', '1'], '2');
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag);
      document.body.append(field);
      expect(
        adjacentRow(keyDown('ArrowDown', { altKey: true }, field), root),
      ).toBeNull();
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not derive `isContentEditable` from the attribute.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(editable);
    expect(
      adjacentRow(keyDown('ArrowDown', { altKey: true }, editable), root),
    ).toBeNull();
  });

  it('leaves the keys to a dialog that is open over the list', () => {
    const root = listOf(['3', '2', '1'], '2');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    expect(
      adjacentRow(keyDown('ArrowDown', { altKey: true }, button), root),
    ).toBeNull();
  });

  it('does nothing while the list is out of reach: hidden or inert', () => {
    const root = listOf(['3', '2', '1'], '2');
    root.setAttribute('inert', '');
    expect(
      adjacentRow(keyDown('ArrowDown', { altKey: true }), root),
    ).toBeNull();
  });
});
