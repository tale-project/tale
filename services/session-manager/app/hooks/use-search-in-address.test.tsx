import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SEARCH_IN_ADDRESS_DELAY_MS,
  useSearchInAddress,
} from './use-search-in-address';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

interface BoxProps {
  /** What the address holds. */
  address: string;
  onWrite: (text: string) => void;
  /** Fills the box, as the list's search box is filled. */
  onBox?: (set: (text: string) => void) => void;
}

/** A search box whose text is the page's own, and an address it is kept in. */
function Box({ address, onWrite, onBox }: BoxProps) {
  const [text, setText] = useState('');
  onBox?.(setText);
  useSearchInAddress({
    text,
    setText,
    addressText: address,
    setAddressText: onWrite,
  });
  return <output>{text}</output>;
}

const shown = (container: HTMLElement) =>
  container.querySelector('output')?.textContent;

/** Lets time pass inside `act`, as the timers of the hook run. */
function elapse(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useSearchInAddress', () => {
  it('leaves everything as it is for an empty box and an address that says nothing', () => {
    const onWrite = vi.fn();
    const { container } = render(<Box address="" onWrite={onWrite} />);

    elapse(SEARCH_IN_ADDRESS_DELAY_MS * 3);

    expect(shown(container)).toBe('');
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('puts what the address says in the box when the page opens, and does not write it back', () => {
    const onWrite = vi.fn();
    const { container } = render(<Box address="shop" onWrite={onWrite} />);

    expect(shown(container)).toBe('shop');
    elapse(SEARCH_IN_ADDRESS_DELAY_MS * 3);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('writes what is typed to the address a moment later, and only the last of a burst of keys', () => {
    const onWrite = vi.fn();
    let set: (text: string) => void = () => {};
    render(<Box address="" onWrite={onWrite} onBox={(next) => (set = next)} />);

    act(() => set('a'));
    elapse(SEARCH_IN_ADDRESS_DELAY_MS - 50);
    act(() => set('ab'));
    elapse(SEARCH_IN_ADDRESS_DELAY_MS - 50);
    act(() => set('abc'));
    expect(onWrite).not.toHaveBeenCalled();

    elapse(SEARCH_IN_ADDRESS_DELAY_MS);
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledWith('abc');
  });

  it('writes an emptied box too, so the address loses the search', () => {
    const onWrite = vi.fn();
    let set: (text: string) => void = () => {};
    render(
      <Box address="shop" onWrite={onWrite} onBox={(next) => (set = next)} />,
    );

    act(() => set(''));
    elapse(SEARCH_IN_ADDRESS_DELAY_MS);

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledWith('');
  });

  it('does not take its own write for news from the address: what was typed meanwhile stays', () => {
    const onWrite = vi.fn();
    let set: (text: string) => void = () => {};
    const { container, rerender } = render(
      <Box address="" onWrite={onWrite} onBox={(next) => (set = next)} />,
    );

    act(() => set('ab'));
    elapse(SEARCH_IN_ADDRESS_DELAY_MS);
    expect(onWrite).toHaveBeenCalledWith('ab');
    // More is typed while the address is still on its way.
    act(() => set('abc'));
    // The address arrives with what was written.
    rerender(
      <Box address="ab" onWrite={onWrite} onBox={(next) => (set = next)} />,
    );

    expect(shown(container)).toBe('abc');
    elapse(SEARCH_IN_ADDRESS_DELAY_MS);
    expect(onWrite).toHaveBeenLastCalledWith('abc');
  });

  it('follows the address when it changes for another reason: a link, the way back', () => {
    const onWrite = vi.fn();
    const { container, rerender } = render(
      <Box address="shop" onWrite={onWrite} />,
    );

    rerender(<Box address="bank" onWrite={onWrite} />);

    expect(shown(container)).toBe('bank');
    elapse(SEARCH_IN_ADDRESS_DELAY_MS * 3);
    expect(onWrite).not.toHaveBeenCalled();

    rerender(<Box address="" onWrite={onWrite} />);
    expect(shown(container)).toBe('');
    elapse(SEARCH_IN_ADDRESS_DELAY_MS * 3);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('writes nothing once the page is gone', () => {
    const onWrite = vi.fn();
    let set: (text: string) => void = () => {};
    const { unmount } = render(
      <Box address="" onWrite={onWrite} onBox={(next) => (set = next)} />,
    );

    act(() => set('ab'));
    unmount();
    elapse(SEARCH_IN_ADDRESS_DELAY_MS * 3);

    expect(onWrite).not.toHaveBeenCalled();
  });

  it('is not woken by a function that is new at every render', () => {
    const onWrite = vi.fn();
    const { rerender } = render(<Box address="shop" onWrite={onWrite} />);
    for (let round = 0; round < 3; round += 1) {
      rerender(<Box address="shop" onWrite={(text) => onWrite(text)} />);
    }
    elapse(SEARCH_IN_ADDRESS_DELAY_MS * 3);
    expect(onWrite).not.toHaveBeenCalled();
  });
});
