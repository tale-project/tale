import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import type { ScheduleOccurrence } from '../../lib/recurrence/schedule';
import { ScheduleOccurrenceList } from './schedule-occurrence-list';

import '../../globals.css';

// Real-Chromium coverage for what jsdom fakes: the contrast of the muted
// rows and the clock-change badge in both themes, and the reader's own time
// wrapping under the start at phone width instead of overflowing.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const STARTS: ScheduleOccurrence[] = [
  { at: Date.UTC(2026, 9, 13, 7, 0), timeZone: 'Europe/Zurich' },
  {
    at: Date.UTC(2026, 9, 25, 0, 30),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'repeatedHour', interval: false },
  },
  {
    at: Date.UTC(2027, 2, 28, 1, 30),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'shiftedForward', wallTime: '02:30' },
  },
];

async function expectNoAxeViolations(element: Element) {
  const result = await axe.run(element, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
  });
  expect(
    result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`,
    ),
  ).toEqual([]);
}

describe.each(['light', 'dark'])('ScheduleOccurrenceList in %s', (theme) => {
  it('passes axe in both variants, muted and with clock changes', async () => {
    await page.viewport(1024, 768);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(
      <div className="bg-background flex flex-col gap-6 p-4">
        <ScheduleOccurrenceList
          occurrences={STARTS}
          referenceYear={2026}
          viewerTimeZone="America/New_York"
        />
        <ScheduleOccurrenceList
          occurrences={STARTS}
          variant="compact"
          referenceYear={2026}
          viewerTimeZone="America/New_York"
        />
        <ScheduleOccurrenceList
          occurrences={STARTS}
          muted
          label="Would run at"
          referenceYear={2026}
          viewerTimeZone="Europe/Zurich"
        />
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('ScheduleOccurrenceList at phone width', () => {
  it('wraps the reader’s time under the start without overflowing 320px', async () => {
    await page.viewport(320, 640);
    render(
      <div className="bg-background w-[288px]">
        <ScheduleOccurrenceList
          occurrences={STARTS}
          referenceYear={2026}
          viewerTimeZone="America/Los_Angeles"
        />
      </div>,
    );
    const list = screen.getByRole('list');
    const box = list.getBoundingClientRect();
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
    for (const part of list.querySelectorAll<HTMLElement>('span, div')) {
      expect(
        part.getBoundingClientRect().right,
        part.outerHTML,
      ).toBeLessThanOrEqual(box.right + 0.5);
    }
  });
});
