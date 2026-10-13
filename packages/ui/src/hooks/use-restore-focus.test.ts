import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RESTORE_FOCUS_LOST_EVENT,
  RESTORE_FOCUS_RETURNED_EVENT,
  useRestoreFocus,
} from './use-restore-focus';

describe('useRestoreFocus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('refocuses the element that was focused when the overlay opened', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open the overlay: the hook captures `trigger` as the opener.
    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });

    // Simulate Radix moving focus into the dialog while it is open.
    const inner = document.createElement('input');
    document.body.appendChild(inner);
    inner.focus();
    expect(document.activeElement).toBe(inner);

    const returned: Event[] = [];
    const recordReturn = (returnedEvent: Event) => returned.push(returnedEvent);
    document.body.addEventListener(RESTORE_FOCUS_RETURNED_EVENT, recordReturn);

    // Closing fires onCloseAutoFocus; the opener should regain focus.
    const event = new Event('close', { cancelable: true });
    result.current(event);
    document.body.removeEventListener(
      RESTORE_FOCUS_RETURNED_EVENT,
      recordReturn,
    );

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(returned).toHaveLength(1);
    expect(returned[0]?.target).toBe(trigger);
    expect(returned[0]?.bubbles).toBe(true);
  });

  it('refocuses the fallback when the opener has been removed from the DOM', () => {
    const trigger = document.createElement('button');
    const fallback = document.createElement('button');
    document.body.append(trigger, fallback);
    trigger.focus();

    const fallbackRef = createRef<HTMLButtonElement>();
    fallbackRef.current = fallback;

    const { result } = renderHook(
      ({ open }) => useRestoreFocus(open, fallbackRef),
      { initialProps: { open: true } },
    );

    // Opener unmounts (e.g. a menu item that closed its menu on open).
    trigger.remove();

    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(fallback);
  });

  it('refocuses the fallback when focus rested on <body> as the overlay opened', () => {
    const fallback = document.createElement('button');
    document.body.append(fallback);
    // The control that held focus was removed in the update that opened the
    // overlay (an edit dialog's Cancel reopening the details it replaced).
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    expect(document.activeElement).toBe(document.body);

    const fallbackRef = createRef<HTMLButtonElement>();
    fallbackRef.current = fallback;

    const { result } = renderHook(
      ({ open }) => useRestoreFocus(open, fallbackRef),
      { initialProps: { open: true } },
    );

    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(fallback);
  });

  it('leaves Radix its default when focus rested on <body> and there is no fallback', () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });

    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('does not refocus an opener that has been removed from the DOM', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });

    // Opener unmounts (e.g. a menu item that closed its menu on open).
    trigger.remove();

    const event = new Event('close', { cancelable: true });
    result.current(event);

    // Radix keeps its default behaviour — we do not preventDefault.
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not announce a return to a disabled opener that cannot take focus', () => {
    const trigger = document.createElement('button');
    const inner = document.createElement('input');
    document.body.append(trigger, inner);
    trigger.focus();
    const { result } = renderHook(() => useRestoreFocus(true));
    inner.focus();
    trigger.disabled = true;
    const returned: Event[] = [];
    trigger.addEventListener(RESTORE_FOCUS_RETURNED_EVENT, (event) =>
      returned.push(event),
    );

    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(returned).toHaveLength(0);
    expect(inner).toHaveFocus();
    expect(event.defaultPrevented).toBe(false);
  });

  it('captures the opener only while open', () => {
    const first = document.createElement('button');
    const second = document.createElement('button');
    document.body.append(first, second);

    first.focus();
    const { result, rerender } = renderHook(
      ({ open }) => useRestoreFocus(open),
      { initialProps: { open: false } },
    );

    // While closed, focus moving to `second` should not be captured.
    second.focus();
    rerender({ open: false });

    // Now open with `first` focused — that is the opener to restore to.
    first.focus();
    rerender({ open: true });

    const inner = document.createElement('input');
    document.body.appendChild(inner);
    inner.focus();

    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(document.activeElement).toBe(first);
  });

  it('prefers the fallback over a menu item still mounted at close time', () => {
    // A dropdown keeps its items mounted through its own closing animation,
    // so the opener is connected AND takes focus — and then unmounts, leaving
    // the document on <body>. Its role is what says it was never a target.
    const trigger = document.createElement('button');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    menu.appendChild(item);
    document.body.append(trigger, menu);
    item.focus();
    expect(document.activeElement).toBe(item);

    const fallbackRef = createRef<HTMLButtonElement>();
    fallbackRef.current = trigger;

    const { result } = renderHook(
      ({ open }) => useRestoreFocus(open, fallbackRef),
      { initialProps: { open: true } },
    );

    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps a menu item as the target when there is no fallback', () => {
    // Nothing better exists, and Radix's own default is <body>.
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    document.body.append(item);
    item.focus();

    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });

    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(false);
  });

  /** A menu button and its open menu holding one item, as Radix renders
   * them: the menu labelled by its button, the button declaring the popup. */
  function openMenu(itemLabel = 'Edit') {
    const trigger = document.createElement('button');
    trigger.id = 'row-menu-trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', trigger.id);
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    item.textContent = itemLabel;
    menu.appendChild(item);
    document.body.append(trigger, menu);
    item.focus();
    return { trigger, menu, item };
  }

  it("returns focus to the menu's button when a menu item opened it", () => {
    // A row's actions menu → Edit: no restore ref at the call site. The menu
    // names its button, and the button is still there once the menu is gone.
    const { trigger, menu } = openMenu();

    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });
    menu.remove();

    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('climbs a submenu to the outermost menu button', () => {
    const { trigger, menu } = openMenu('More');
    const subTrigger = menu.querySelector<HTMLElement>('[role="menuitem"]');
    if (subTrigger === null) throw new Error('no item');
    subTrigger.id = 'row-menu-more';
    subTrigger.setAttribute('aria-haspopup', 'menu');
    const submenu = document.createElement('div');
    submenu.setAttribute('role', 'menu');
    submenu.setAttribute('aria-labelledby', subTrigger.id);
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    submenu.appendChild(item);
    document.body.appendChild(submenu);
    item.focus();

    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });
    menu.remove();
    submenu.remove();
    result.current(new Event('close', { cancelable: true }));

    expect(document.activeElement).toBe(trigger);
  });

  it('finds the button that controls a menu naming no label', () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-controls', 'actions-menu');
    const menu = document.createElement('div');
    menu.id = 'actions-menu';
    menu.setAttribute('role', 'menu');
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    menu.appendChild(item);
    document.body.append(trigger, menu);
    item.focus();

    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });
    menu.remove();
    result.current(new Event('close', { cancelable: true }));

    expect(document.activeElement).toBe(trigger);
  });

  it("prefers the caller's fallback over the menu's button", () => {
    openMenu();
    const toolbar = document.createElement('button');
    document.body.appendChild(toolbar);
    const fallbackRef = createRef<HTMLButtonElement>();
    fallbackRef.current = toolbar;

    const { result } = renderHook(
      ({ open }) => useRestoreFocus(open, fallbackRef),
      { initialProps: { open: true } },
    );
    result.current(new Event('close', { cancelable: true }));

    expect(document.activeElement).toBe(toolbar);
  });

  it('never takes a label that opens nothing for the menu button', () => {
    // A listbox labelled by its heading: the heading is no return point.
    const heading = document.createElement('h2');
    heading.id = 'picker-heading';
    heading.tabIndex = -1;
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-labelledby', heading.id);
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.tabIndex = 0;
    listbox.appendChild(option);
    document.body.append(heading, listbox);
    option.focus();

    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });
    listbox.remove();
    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(heading);
  });

  it('leaves Radix its default when the menu button is gone too', () => {
    // The whole row went (another session deleted it): nothing to return to.
    const { trigger, menu } = openMenu();

    const { result } = renderHook(({ open }) => useRestoreFocus(open), {
      initialProps: { open: true },
    });
    menu.remove();
    trigger.remove();
    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(false);
  });

  // #3791: a confirmed delete takes the row, its menu button with it — the
  // completion path, where Escape (#3715) still finds the button.
  describe('when a completed action removed every return point', () => {
    /** A list region holding one row, whose menu is open on its item. */
    function openRowMenu() {
      const region = document.createElement('div');
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Teams');
      region.tabIndex = -1;
      const list = document.createElement('ul');
      const row = document.createElement('li');
      const next = document.createElement('button');
      next.textContent = 'Actions for Beta';
      list.append(row, next);
      region.append(list);
      document.body.append(region);
      const { trigger, menu } = openMenu('Delete');
      row.append(trigger);
      return { region, list, row, trigger, menu, next };
    }

    it('asks what survived, and keeps the answer', () => {
      const { region, row, menu, next } = openRowMenu();
      const lost: Event[] = [];
      region.addEventListener(RESTORE_FOCUS_LOST_EVENT, (event) => {
        lost.push(event);
        next.focus();
        event.preventDefault();
      });

      const { result } = renderHook(({ open }) => useRestoreFocus(open), {
        initialProps: { open: true },
      });
      menu.remove();
      row.remove();
      const event = new Event('close', { cancelable: true });
      result.current(event);

      expect(lost).toHaveLength(1);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(next);
    });

    it('focuses the nearest surviving region when nothing answers', () => {
      const { region, row, menu } = openRowMenu();

      const { result } = renderHook(({ open }) => useRestoreFocus(open), {
        initialProps: { open: true },
      });
      menu.remove();
      row.remove();
      const event = new Event('close', { cancelable: true });
      result.current(event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(region);
    });

    it('skips a menu button its row disabled, as it skips a removed one', () => {
      // Teams disables a deleted row's menu button until the list drops it.
      const { region, trigger, menu } = openRowMenu();

      const { result } = renderHook(({ open }) => useRestoreFocus(open), {
        initialProps: { open: true },
      });
      menu.remove();
      trigger.disabled = true;
      const event = new Event('close', { cancelable: true });
      result.current(event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(region);
    });

    it('skips a removed fallback for the menu button that survived', () => {
      const { trigger, menu } = openRowMenu();
      const fallback = document.createElement('button');
      document.body.append(fallback);
      const fallbackRef = createRef<HTMLButtonElement>();
      fallbackRef.current = fallback;

      const { result } = renderHook(
        ({ open }) => useRestoreFocus(open, fallbackRef),
        { initialProps: { open: true } },
      );
      menu.remove();
      fallback.remove();
      result.current(new Event('close', { cancelable: true }));

      expect(document.activeElement).toBe(trigger);
    });
  });

  it('leaves an ordinary control that merely sits in a menu alone', () => {
    // The rule is the element's own role, not its ancestry: a button inside a
    // menu-labelled container is still a real control.
    const trigger = document.createElement('button');
    const opener = document.createElement('button');
    document.body.append(trigger, opener);
    opener.focus();

    const fallbackRef = createRef<HTMLButtonElement>();
    fallbackRef.current = trigger;

    const { result } = renderHook(
      ({ open }) => useRestoreFocus(open, fallbackRef),
      { initialProps: { open: true } },
    );
    result.current(new Event('close', { cancelable: true }));

    expect(document.activeElement).toBe(opener);
  });

  it('returns a stable handler across renders', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useRestoreFocus(open),
      { initialProps: { open: true } },
    );
    const first = result.current;
    rerender({ open: true });
    expect(result.current).toBe(first);
  });
});
