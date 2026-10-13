import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { act, render, screen } from '@/tests/utils/render';

import { SegmentedControl } from './segmented-control';

afterEach(cleanup);

function ControlledSegments() {
  const [value, setValue] = useState('all');
  return (
    <SegmentedControl
      aria-label="Which pages to show"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'all', label: 'All' },
        { value: 'failed', label: 'Failed' },
      ]}
    />
  );
}

it('keeps newer keyboard selection when an older navigation reset runs', async () => {
  render(<ControlledSegments />);
  const all = screen.getByRole('radio', { name: 'All' });
  const failed = screen.getByRole('radio', { name: 'Failed' });
  await userEvent.click(all);

  // Chromium can deliver the next key after focus but before the prior key's
  // reset timer. Hold only timers created during native keydown to reproduce
  // that legal ordering deterministically, without mocking focus or key input.
  const nativeTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeClear = globalThis.clearTimeout.bind(globalThis);
  const pending: Array<() => void> = [];
  const active = new Set<unknown>();
  let capturing = false;
  const startCapture = () => {
    capturing = true;
  };
  const endCapture = () => {
    capturing = false;
  };
  window.addEventListener('keydown', startCapture, true);
  window.addEventListener('keydown', endCapture);
  const timeout = vi
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation((callback, delay, ...args) => {
      if (!capturing || typeof callback !== 'function' || (delay ?? 0) !== 0) {
        return nativeTimeout(callback, delay, ...args);
      }
      const id = nativeTimeout(() => {}, 0);
      active.add(id);
      pending.push(() => {
        if (active.delete(id)) callback(...args);
      });
      return id;
    });
  const clear = vi
    .spyOn(globalThis, 'clearTimeout')
    .mockImplementation((id) => {
      active.delete(id);
      nativeClear(id);
    });
  const runNext = () => {
    const next = pending.shift();
    expect(next).toBeDefined();
    act(() => next?.());
  };

  try {
    await userEvent.keyboard('{ArrowRight}');
    runNext();
    expect(failed).toHaveFocus();
    expect(failed).toHaveAttribute('aria-checked', 'true');

    await userEvent.keyboard('{ArrowLeft}');
    runNext(); // The previous key's reset must not erase the newer intent.
    runNext(); // Radix focuses All for ArrowLeft.
    expect(all).toHaveFocus();
    expect(all).toHaveAttribute('aria-checked', 'true');
    expect(failed).toHaveAttribute('aria-checked', 'false');
  } finally {
    window.removeEventListener('keydown', startCapture, true);
    window.removeEventListener('keydown', endCapture);
    timeout.mockRestore();
    clear.mockRestore();
    active.clear();
  }
});
