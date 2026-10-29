import { describe, expect, it } from 'vitest';

import type { OneDriveApiItem, OneDriveSelectedItem } from './types';
import {
  toggleVisibleSelection,
  visibleSelectionState,
} from './visible-selection';

const file = (id: string): OneDriveApiItem => ({
  id,
  name: `${id}.txt`,
  size: 10,
  isFolder: false,
});

const alpha = file('alpha');
const bravo = file('bravo');
const charlie = file('charlie');
const docs: OneDriveApiItem = {
  id: 'docs',
  name: 'Docs',
  size: 0,
  isFolder: true,
};

const selectionOf = (...items: OneDriveApiItem[]) =>
  new Map<string, OneDriveSelectedItem>(
    items.map((item) => [
      item.id,
      { id: item.id, name: item.name, path: item.id, type: 'file' },
    ]),
  );

const pathUnderParent = (item: OneDriveApiItem) => `parent/${item.id}`;

describe('visibleSelectionState', () => {
  it('is clear when no row is on screen', () => {
    expect(visibleSelectionState([], selectionOf(alpha))).toBe(false);
  });

  it('is clear when only a row off screen is selected', () => {
    expect(visibleSelectionState([bravo], selectionOf(alpha))).toBe(false);
  });

  it('is checked when every row on screen is selected, whatever is off screen', () => {
    expect(visibleSelectionState([bravo], selectionOf(alpha, bravo))).toBe(
      true,
    );
  });

  it('is mixed when some rows on screen are selected', () => {
    expect(visibleSelectionState([bravo, charlie], selectionOf(bravo))).toBe(
      'indeterminate',
    );
  });
});

describe('toggleVisibleSelection', () => {
  it('adds the rows on screen and keeps a row selected off screen', () => {
    const next = toggleVisibleSelection(
      selectionOf(alpha),
      [bravo, docs],
      true,
      pathUnderParent,
    );

    expect([...next.keys()]).toEqual(['alpha', 'bravo', 'docs']);
    expect(next.get('bravo')).toEqual({
      id: 'bravo',
      name: 'bravo.txt',
      path: 'parent/bravo',
      type: 'file',
      size: 10,
    });
    expect(next.get('docs')).toMatchObject({ type: 'folder' });
  });

  // Regression: clearing the box emptied the whole selection on the
  // Microsoft tabs, so a file selected under an earlier search was lost.
  it('removes the rows on screen alone when cleared', () => {
    const next = toggleVisibleSelection(
      selectionOf(alpha, bravo, charlie),
      [bravo, charlie],
      false,
      pathUnderParent,
    );

    expect([...next.keys()]).toEqual(['alpha']);
  });

  it('leaves the selection it was given untouched', () => {
    const selected = selectionOf(alpha);

    toggleVisibleSelection(selected, [bravo], true, pathUnderParent);
    toggleVisibleSelection(selected, [alpha], false, pathUnderParent);

    expect([...selected.keys()]).toEqual(['alpha']);
  });
});
