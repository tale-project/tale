import { afterEach, describe, expect, it } from 'vitest';

import { adjacentRow, homeRowLinks } from './row-navigation';

/** A panel with a projects list (`ul`) above a work list (`ol`). */
function panel(openKey?: string) {
  const root = document.createElement('div');
  root.innerHTML = `
    <ul><li><a href="/p1" data-indicator-key="p1">Project</a></li></ul>
    <ol>
      <li><a href="/chat/a" data-indicator-key="chat:a">A</a><button>⋯</button></li>
      <li><a href="/tasks/b" data-indicator-key="task:b">B</a></li>
      <li><a href="/chat/c" data-indicator-key="chat:c">C</a></li>
    </ol>
    <input aria-label="search" />
  `;
  if (openKey !== undefined) {
    root
      .querySelector(`[data-indicator-key="${openKey}"]`)
      ?.setAttribute('aria-current', 'page');
  }
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

function keys(
  key: string,
  target: EventTarget | null,
  modifiers: Partial<
    Record<'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey', boolean>
  > = {},
) {
  return {
    key,
    target,
    defaultPrevented: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe('homeRowLinks', () => {
  it('lists every row link in reading order, menus aside', () => {
    expect(
      homeRowLinks(panel()).map((link) => link.dataset.indicatorKey),
    ).toEqual(['p1', 'chat:a', 'task:b', 'chat:c']);
  });
});

describe('adjacentRow', () => {
  it('leads from the open item to the next and the previous one', () => {
    const root = panel('task:b');
    expect(
      adjacentRow(keys('ArrowDown', document.body, { altKey: true }), root)
        ?.dataset.indicatorKey,
    ).toBe('chat:c');
    expect(
      adjacentRow(keys('ArrowUp', document.body, { altKey: true }), root)
        ?.dataset.indicatorKey,
    ).toBe('chat:a');
  });

  it('starts at an end of the work list when nothing in it is open, skipping projects', () => {
    const root = panel('p1');
    expect(
      adjacentRow(keys('ArrowDown', document.body, { altKey: true }), root)
        ?.dataset.indicatorKey,
    ).toBe('chat:a');
    expect(
      adjacentRow(keys('ArrowUp', document.body, { altKey: true }), root)
        ?.dataset.indicatorKey,
    ).toBe('chat:c');
  });

  it.each([
    'dialog',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
  ])('leaves shortcuts inside %s to the dialog', (selector) => {
    const root = panel('task:b');
    const dialog = document.createElement(
      selector === 'dialog' ? 'dialog' : 'div',
    );
    if (selector.includes('role='))
      dialog.setAttribute(
        'role',
        selector.includes('alertdialog') ? 'alertdialog' : 'dialog',
      );
    if (selector.includes('aria-modal'))
      dialog.setAttribute('aria-modal', 'true');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    for (const key of ['ArrowDown', 'ArrowUp']) {
      expect(adjacentRow(keys(key, button, { altKey: true }), root)).toBeNull();
    }
  });

  it.each(['inert', 'hidden', 'aria-hidden'])(
    'ignores a navigator under a %s ancestor',
    (attribute) => {
      const root = panel('task:b');
      const wrapper = document.createElement('div');
      wrapper.setAttribute(
        attribute,
        attribute === 'aria-hidden' ? 'true' : '',
      );
      wrapper.append(root);
      document.body.append(wrapper);
      expect(
        adjacentRow(keys('ArrowDown', document.body, { altKey: true }), root),
      ).toBeNull();
    },
  );

  it('leaves an already handled event alone', () => {
    const root = panel('task:b');
    expect(
      adjacentRow(
        {
          ...keys('ArrowDown', document.body, { altKey: true }),
          defaultPrevented: true,
        },
        root,
      ),
    ).toBeNull();
  });

  it('stops at the ends', () => {
    const root = panel('chat:c');
    expect(
      adjacentRow(keys('ArrowDown', document.body, { altKey: true }), root),
    ).toBeNull();
  });

  it('leaves the keys to a text field and to other chords', () => {
    const root = panel('task:b');
    const input = root.querySelector('input');
    expect(
      adjacentRow(keys('ArrowDown', input, { altKey: true }), root),
    ).toBeNull();
    expect(adjacentRow(keys('ArrowDown', document.body), root)).toBeNull();
    expect(
      adjacentRow(
        keys('ArrowDown', document.body, { altKey: true, shiftKey: true }),
        root,
      ),
    ).toBeNull();
  });
});
