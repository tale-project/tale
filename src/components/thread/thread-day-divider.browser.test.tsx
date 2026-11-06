import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render } from '@/tests/utils/render';

import { ThreadDayDivider } from './thread-day-divider';

import '../../globals.css';

// Real-Chromium coverage for the pinned pill: it stays near the top of the
// scroller while its day scrolls by, its hairline scrolls away with the
// day's first entries, and the next day's pill takes over.
afterEach(cleanup);

beforeEach(async () => {
  await page.viewport(1024, 768);
});

function Day({ label, entries }: { label: string; entries: number }) {
  return (
    <section>
      <ThreadDayDivider>{label}</ThreadDayDivider>
      <ol className="flex flex-col gap-6">
        {Array.from({ length: entries }, (_, i) => (
          <li key={i} className="h-10 text-sm">
            {label} entry {i + 1}
          </li>
        ))}
      </ol>
    </section>
  );
}

function renderThread() {
  render(
    <div
      data-testid="scroller"
      style={{ height: 300, width: 480, overflowY: 'auto' }}
    >
      <Day label="Monday" entries={20} />
      <Day label="Today" entries={20} />
    </div>,
  );
  return screen.getByTestId('scroller');
}

function top(el: Element): number {
  return el.getBoundingClientRect().top;
}

describe('ThreadDayDivider (real layout)', () => {
  it('centres the hairline behind the pill where the day begins', () => {
    renderThread();
    const pill = screen.getByText('Monday');
    const rule = document.querySelector('[data-slot="thread-day-rule"]')!;
    const pillBox = pill.getBoundingClientRect();
    const ruleBox = rule.getBoundingClientRect();
    expect(ruleBox.top).toBeGreaterThan(pillBox.top);
    expect(ruleBox.bottom).toBeLessThan(pillBox.bottom);
    expect(
      Math.abs(ruleBox.top - (pillBox.top + pillBox.height / 2)),
    ).toBeLessThanOrEqual(1);
  });

  it('pins its pill while its day scrolls by, and leaves the hairline behind', () => {
    const scroller = renderThread();
    scroller.scrollTop = 400;

    const pill = screen.getByText('Monday');
    // Pinned 8px under the scroller's top edge (`top-2`).
    expect(top(pill.closest('[data-slot="thread-day-divider"]')!)).toBeCloseTo(
      top(scroller) + 8,
      0,
    );
    // The hairline stayed where the day began, above the viewport.
    const rule = document.querySelector('[data-slot="thread-day-rule"]')!;
    expect(rule.getBoundingClientRect().bottom).toBeLessThan(top(scroller));
  });

  it('hands over to the next day’s pill', () => {
    const scroller = renderThread();
    const today = screen.getByText('Today');
    scroller.scrollTop = scroller.scrollHeight;

    expect(top(today.closest('[data-slot="thread-day-divider"]')!)).toBeCloseTo(
      top(scroller) + 8,
      0,
    );
    // Monday's pill went up with the end of its day.
    expect(
      screen.getByText('Monday').getBoundingClientRect().bottom,
    ).toBeLessThan(top(scroller));
  });
});
