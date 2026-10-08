import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { ScheduleOccurrence } from '../../lib/recurrence/schedule';
import { ScheduleOccurrenceList } from './schedule-occurrence-list';

const ZURICH = 'Europe/Zurich';
const NEW_YORK = 'America/New_York';

/** 09:00 in Zurich on Tue–Thu, Oct 13–15, 2026 (07:00 UTC). */
const WEEK: ScheduleOccurrence[] = [13, 14, 15].map((day) => ({
  at: Date.UTC(2026, 9, day, 7, 0),
  timeZone: ZURICH,
}));

/** Engines differ on the space before AM/PM: compare words. */
const plain = (text: string | null | undefined) =>
  (text ?? '').replace(/[\s  ]+/g, ' ').trim();

function rows() {
  return screen.getAllByRole('listitem').map((row) => plain(row.textContent));
}

describe('ScheduleOccurrenceList', () => {
  it('lists the starts in the schedule zone under a heading that names it', async () => {
    const { container } = render(
      <ScheduleOccurrenceList occurrences={WEEK} viewerTimeZone={ZURICH} />,
    );
    const list = screen.getByRole('list', {
      name: 'Next runs · Europe/Zurich',
    });
    expect(list.tagName).toBe('OL');
    expect(rows()).toEqual([
      'Tue, Oct 13, 9:00 AM',
      'Wed, Oct 14, 9:00 AM',
      'Thu, Oct 15, 9:00 AM',
    ]);
    await checkAccessibility(container);
  });

  it('adds the reader’s own time in a full list when their zone differs', () => {
    render(
      <ScheduleOccurrenceList occurrences={WEEK} viewerTimeZone={NEW_YORK} />,
    );
    expect(rows()[0]).toBe('Tue, Oct 13, 9:00 AM 3:00 AM in your time zone');
  });

  it('names the reader’s date when their day differs', () => {
    // 01:00 in Zurich is still the evening before in New York.
    render(
      <ScheduleOccurrenceList
        occurrences={[{ at: Date.UTC(2026, 9, 12, 23, 0), timeZone: ZURICH }]}
        viewerTimeZone={NEW_YORK}
      />,
    );
    expect(rows()[0]).toBe(
      'Tue, Oct 13, 1:00 AM Mon, Oct 12, 7:00 PM in your time zone',
    );
  });

  it('says the reader’s zone once in a compact list, instead of per row', () => {
    render(
      <ScheduleOccurrenceList
        occurrences={WEEK}
        variant="compact"
        count={2}
        viewerTimeZone={NEW_YORK}
      />,
    );
    expect(rows()).toEqual(['Tue, Oct 13, 9:00 AM', 'Wed, Oct 14, 9:00 AM']);
    expect(
      screen.getByText('Your time zone is America/New_York.'),
    ).toBeVisible();
  });

  it('says nothing about the reader’s zone when it is the schedule’s', () => {
    render(
      <ScheduleOccurrenceList
        occurrences={WEEK}
        variant="compact"
        viewerTimeZone={ZURICH}
      />,
    );
    expect(screen.queryByText(/Your time zone/)).toBeNull();
  });

  it('shows the year only for a start in another year', () => {
    render(
      <ScheduleOccurrenceList
        occurrences={[
          { at: Date.UTC(2026, 11, 31, 8, 0), timeZone: ZURICH },
          { at: Date.UTC(2027, 0, 1, 8, 0), timeZone: ZURICH },
        ]}
        referenceYear={2026}
        viewerTimeZone={ZURICH}
      />,
    );
    expect(rows()).toEqual([
      'Thu, Dec 31, 9:00 AM',
      'Fri, Jan 1, 2027, 9:00 AM',
    ]);
  });

  it('explains a clock change on the page, not in a tooltip', () => {
    render(
      <ScheduleOccurrenceList
        occurrences={[
          {
            at: Date.UTC(2026, 2, 29, 1, 30),
            timeZone: ZURICH,
            clockChange: { kind: 'shiftedForward', wallTime: '02:30' },
          },
          {
            at: Date.UTC(2026, 9, 25, 0, 30),
            timeZone: ZURICH,
            clockChange: { kind: 'repeatedHour', interval: false },
          },
          {
            at: Date.UTC(2026, 9, 25, 1, 15),
            timeZone: ZURICH,
            clockChange: { kind: 'repeatedHour', interval: true },
          },
        ]}
        viewerTimeZone={ZURICH}
      />,
    );
    const [shifted, repeated, grid] = screen.getAllByRole('listitem');
    expect(
      within(shifted as HTMLElement).getByText('Clock change'),
    ).toBeVisible();
    expect(plain(shifted?.textContent)).toContain(
      "2:30 AM doesn't exist that day, so this run starts at 3:30 AM.",
    );
    expect(plain(repeated?.textContent)).toContain(
      '2:30 AM happens twice that day; it runs once, at the first.',
    );
    expect(plain(grid?.textContent)).toContain(
      'Clocks go back: this hour repeats, and runs keep their real-time spacing.',
    );
  });

  it('mutes the rows of starts that would happen, and lists at most count', () => {
    render(
      <ScheduleOccurrenceList
        occurrences={WEEK}
        muted
        count={1}
        label="Would run at"
        showZone={false}
        viewerTimeZone={ZURICH}
      />,
    );
    const list = screen.getByRole('list', { name: 'Would run at' });
    expect(list).toHaveClass('text-muted-foreground');
    expect(rows()).toHaveLength(1);
  });

  it('says so when no start comes', () => {
    render(<ScheduleOccurrenceList occurrences={[]} />);
    expect(screen.getByText('Next runs')).toBeVisible();
    expect(screen.getByText('No upcoming runs.')).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('writes 24-hour times when the host fixes the cycle', () => {
    render(
      <ScheduleOccurrenceList
        occurrences={WEEK.slice(0, 1)}
        hourCycle={24}
        viewerTimeZone={ZURICH}
      />,
    );
    expect(rows()).toEqual(['Tue, Oct 13, 09:00']);
  });
});
