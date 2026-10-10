import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { Duration, formatDuration } from './duration';

import '../../globals.css';

// Real-Chromium coverage: live durations tick on one shared timer, and the
// words match what the browser's own Intl.DurationFormat says.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Duration', () => {
  it('ticks every live duration once a second on one timer', async () => {
    const setInterval = vi.spyOn(window, 'setInterval');
    const since = Date.now() - 4000;
    render(
      <>
        <Duration since={since} live />
        <Duration since={since - 60_000} live />
        <Duration since={since - 3_600_000} live />
      </>,
    );
    const times = [...document.querySelectorAll('time')];
    expect(times).toHaveLength(3);
    expect(
      setInterval.mock.calls.filter(([, delay]) => delay === 1000),
    ).toHaveLength(1);
    const before = times[0].textContent;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(times[0].textContent).not.toBe(before);
    expect(times[0]).toHaveAttribute('aria-live', 'off');
    expect(times[0].getAttribute('dateTime')).toMatch(/^PT\d+(\.\d+)?S$/);
  });

  it('writes a finished span once, without a timer', () => {
    const setInterval = vi.spyOn(window, 'setInterval');
    render(<Duration ms={192_000} unitDisplay="narrow" />);
    expect(screen.getByText('3m 12s')).toBeInTheDocument();
    expect(setInterval).not.toHaveBeenCalled();
  });
});

describe('formatDuration in a browser with Intl.DurationFormat', () => {
  it('says what Intl.DurationFormat says, in every style and language', () => {
    const DurationFormat = (
      Intl as unknown as {
        DurationFormat?: new (
          locale: string,
          options: { style: string },
        ) => { format: (duration: Record<string, number>) => string };
      }
    ).DurationFormat;
    if (DurationFormat === undefined) return;
    const cases: Array<[number, Record<string, number>]> = [
      [320, { milliseconds: 320 }],
      [42_000, { seconds: 42 }],
      [192_000, { minutes: 3, seconds: 12 }],
      [7_500_000, { hours: 2, minutes: 5 }],
      [97_200_000, { days: 1, hours: 3 }],
    ];
    for (const locale of ['en', 'de', 'fr', 'de-CH']) {
      for (const style of ['narrow', 'short', 'long'] as const) {
        for (const [ms, duration] of cases) {
          expect(formatDuration(ms, locale, { style })).toBe(
            new DurationFormat(locale, { style }).format(duration),
          );
        }
      }
    }
  });
});
