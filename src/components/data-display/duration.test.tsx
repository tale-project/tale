import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, renderHook, screen } from '@/tests/utils/render';

import { Duration, useFormatDuration } from './duration';

describe('Duration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-09T07:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a span as words in a <time> with the exact span', async () => {
    const { container } = render(<Duration ms={3240} />);
    const time = container.querySelector('time');
    expect(time).toHaveTextContent('3.2 sec');
    expect(time).toHaveAttribute('dateTime', 'PT3.24S');
    expect(time).toHaveAttribute('aria-live', 'off');
    vi.useRealTimers();
    await checkAccessibility(container);
  });

  it('counts on once a second from `since` when live', () => {
    const start = Date.now() - 12_000;
    render(<Duration since={start} live />);
    expect(screen.getByText('12 sec')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('13 sec')).toBeInTheDocument();
  });

  it('stays at its first reading from `since` when not live', () => {
    const start = Date.now() - 12_000;
    render(<Duration since={start} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('12 sec')).toBeInTheDocument();
  });

  it('renders nothing without a span', () => {
    const { container } = render(<Duration />);
    expect(container.querySelector('time')).toBeNull();
  });
});

describe('useFormatDuration', () => {
  it('formats in the reader’s language', () => {
    const { result } = renderHook(() => useFormatDuration());
    expect(result.current(90_000, { style: 'long', maxUnits: 1 })).toBe(
      '1.5 minutes',
    );
  });
});
