import { renderHook } from '@testing-library/react';
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
