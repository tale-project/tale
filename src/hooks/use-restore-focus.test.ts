import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useRestoreFocus } from './use-restore-focus';

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

    // Closing fires onCloseAutoFocus; the opener should regain focus.
    const event = new Event('close', { cancelable: true });
    result.current(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
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
