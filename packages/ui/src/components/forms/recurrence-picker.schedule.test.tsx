import { CalendarClock } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { RecurrenceRule } from '../../lib/recurrence/rule';
import type {
  ScheduleOccurrence,
  ScheduleReference,
  ScheduleRule,
} from '../../lib/recurrence/schedule';
import { Checkbox } from './checkbox';
import { RecurrencePicker } from './recurrence-picker';

/** Tue Sep 29, 2026, at the default 09:00. */
const TUESDAY: ScheduleReference = {
  year: 2026,
  month: 9,
  day: 29,
  weekday: 2,
};

const WEEKDAYS_TWICE: ScheduleRule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1, 2, 3, 4, 5],
  times: ['09:00', '17:30'],
};

/** Engines differ on the space before AM/PM: compare words. */
const plain = (text: string | null | undefined) =>
  (text ?? '').replace(/[\s  ]+/g, ' ').trim();

/** A stand-in for the host's schedule engine: the next three days at the
 *  rule's first time, in Zurich. */
function nextOccurrences(rule: ScheduleRule): ScheduleOccurrence[] {
  const hour = 'times' in rule ? Number(rule.times[0]?.slice(0, 2)) : 9;
  return [1, 2, 3].map((offset) => ({
    at: Date.UTC(2026, 8, 29 + offset, hour - 2, 0),
    timeZone: 'Europe/Zurich',
  }));
}

interface HarnessProps {
  initial?: ScheduleRule | null;
  onChange?: (rule: ScheduleRule | null) => void;
}

function Harness({ initial = null, onChange }: HarnessProps) {
  const [value, setValue] = useState<ScheduleRule | null>(initial);
  return (
    <RecurrencePicker
      granularity="time"
      reference={TUESDAY}
      value={value}
      onChange={(rule) => {
        setValue(rule);
        onChange?.(rule);
      }}
    />
  );
}

/** The trigger host a schedule trigger is: there is always a rule. */
function Required({
  initial = WEEKDAYS_TWICE,
  onChange,
}: {
  initial?: ScheduleRule;
  onChange?: (rule: ScheduleRule) => void;
}) {
  const [value, setValue] = useState<ScheduleRule>(initial);
  return (
    <RecurrencePicker
      granularity="time"
      allowNever={false}
      variant="default"
      icon={CalendarClock}
      reference={TUESDAY}
      value={value}
      nextOccurrences={nextOccurrences}
      onChange={(rule) => {
        setValue(rule);
        onChange?.(rule);
      }}
    />
  );
}

async function openPicker(
  user: ReturnType<typeof render>['user'],
  name: RegExp | string = /^Schedule/,
) {
  await user.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name: 'Schedule' });
}

describe('RecurrencePicker in time mode', () => {
  describe('types', () => {
    it('types onChange as a day rule without granularity, and non-null without Never', () => {
      type Props = ComponentProps<typeof RecurrencePicker>;
      type DayChange = Extract<Props, { granularity?: 'day' }>['onChange'];
      expectTypeOf<
        Parameters<DayChange>[0]
      >().toEqualTypeOf<RecurrenceRule | null>();
      const day = (
        <RecurrencePicker
          value={null}
          reference={TUESDAY}
          onChange={(rule) => {
            expectTypeOf(rule).toEqualTypeOf<RecurrenceRule | null>();
          }}
        />
      );
      const required = (
        <RecurrencePicker
          granularity="time"
          allowNever={false}
          value={WEEKDAYS_TWICE}
          reference={TUESDAY}
          onChange={(rule) => {
            expectTypeOf(rule).toEqualTypeOf<ScheduleRule>();
          }}
        />
      );
      const optional = (
        <RecurrencePicker
          granularity="time"
          value={null}
          reference={TUESDAY}
          onChange={(rule) => {
            expectTypeOf(rule).toEqualTypeOf<ScheduleRule | null>();
          }}
        />
      );
      const refused = (
        // @ts-expect-error -- without Never, the value is never null.
        <RecurrencePicker
          granularity="time"
          allowNever={false}
          value={null}
          reference={TUESDAY}
          onChange={() => {}}
        />
      );
      expect([day, required, optional, refused]).toHaveLength(4);
    });
  });

  describe('trigger', () => {
    it('reads the schedule compactly and in full, under the Schedule label', async () => {
      const { container } = render(<Required />);
      const trigger = screen.getByRole('button', { name: /^Schedule:/ });
      expect(plain(trigger.getAttribute('aria-label'))).toBe(
        'Schedule: Weekdays, 9:00 AM, 5:30 PM',
      );
      expect(plain(trigger.textContent)).toBe('Weekdays · 9:00 AM, 5:30 PM');
      expect(trigger).toHaveAccessibleDescription(
        /^Every weekday at 9:00\sAM and 5:30\sPM$/,
      );
      expect(container.querySelector('.lucide-calendar-clock')).not.toBeNull();
      await checkAccessibility(container);
    });

    it('reads Never while a rule is optional and none is set', () => {
      render(<Harness />);
      expect(
        screen.getByRole('button', { name: 'Schedule: Never' }),
      ).toBeVisible();
    });

    it('renders plain text when read-only, and explains a lock', () => {
      const { rerender } = render(
        <RecurrencePicker
          granularity="time"
          readOnly
          value={WEEKDAYS_TWICE}
          reference={TUESDAY}
          onChange={() => {}}
        />,
      );
      expect(screen.queryByRole('button')).toBeNull();
      expect(plain(screen.getByText(/^Every weekday at/).textContent)).toBe(
        'Every weekday at 9:00 AM and 5:30 PM',
      );
      rerender(
        <RecurrencePicker
          granularity="time"
          disabled
          disabledReason="Deploy a version first."
          value={WEEKDAYS_TWICE}
          reference={TUESDAY}
          onChange={() => {}}
        />,
      );
      expect(
        screen.getByRole('button', { name: /^Schedule:/ }),
      ).toHaveAccessibleDescription(/Deploy a version first\.$/);
    });
  });

  describe('presets', () => {
    it('lists the schedule presets at the saved time, without Never when it is not allowed', async () => {
      const { user } = render(
        <Required
          initial={{ frequency: 'daily', interval: 1, times: ['07:30'] }}
        />,
      );
      const dialog = await openPicker(user);
      const presets = within(dialog).getByRole('radiogroup', {
        name: 'Presets',
      });
      expect(
        within(presets)
          .getAllByRole('radio')
          .map((row) => plain(row.textContent)),
      ).toEqual([
        'Every 15 minutes',
        'Every hour',
        'Daily at 7:30 AM',
        'Every weekday at 7:30 AMMon–Fri',
        'Weekly on Tuesday at 7:30 AM',
        'Monthly on day 29 at 7:30 AM',
      ]);
      const daily = within(presets).getByRole('radio', {
        name: /^Daily at 7:30/,
      });
      expect(daily).toHaveAttribute('aria-checked', 'true');
      await waitFor(() => expect(daily).toHaveFocus());
      await checkAccessibility(document.body);
    });

    it('offers Never first when a rule is optional, and gives null for it', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <Harness initial={WEEKDAYS_TWICE} onChange={onChange} />,
      );
      const dialog = await openPicker(user);
      const rows = within(dialog).getAllByRole('radio');
      expect(rows[0]).toHaveAccessibleName('Never');
      await user.click(rows[0] as HTMLElement);
      expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('saves a preset once and closes; the saved one calls nothing', async () => {
      const onChange = vi.fn();
      const { user } = render(<Required onChange={onChange} />);
      let dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('radio', { name: 'Every 15 minutes' }),
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        frequency: 'minutely',
        interval: 15,
      });
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Schedule: Every 15 minutes' }),
        ).toHaveFocus(),
      );
      onChange.mockClear();
      dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('radio', { name: 'Every 15 minutes' }),
      );
      expect(onChange).not.toHaveBeenCalled();
    });

    it('checks the custom row of the rule’s kind and focuses it', async () => {
      const { user } = render(<Required />);
      const dialog = await openPicker(user);
      const times = within(dialog).getByRole('button', {
        name: 'Custom times',
      });
      expect(times).toHaveAccessibleDescription(
        /^Every weekday at 9:00\sAM and 5:30\sPM$/,
      );
      await waitFor(() => expect(times).toHaveFocus());
      expect(
        within(dialog).getByRole('button', { name: 'Custom interval' }),
      ).not.toHaveAttribute('aria-describedby');
    });

    it('lists the next runs the host computes, in the schedule zone', async () => {
      const { user } = render(<Required />);
      const dialog = await openPicker(user);
      const runs = within(dialog).getByRole('list', {
        name: 'Next runs · Europe/Zurich',
      });
      expect(within(runs).getAllByRole('listitem')).toHaveLength(3);
    });
  });

  describe('Custom times', () => {
    it('adds, removes and deduplicates times, and saves them sorted once', async () => {
      const onChange = vi.fn();
      const { user } = render(<Required onChange={onChange} />);
      const dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom times' }),
      );
      await waitFor(() =>
        expect(
          within(dialog).getByRole('radio', { name: 'Week' }),
        ).toHaveFocus(),
      );
      const at = within(dialog).getByRole('list', { name: 'At' });
      expect(within(at).getAllByRole('group')).toHaveLength(2);
      await user.click(
        within(dialog).getByRole('button', { name: 'Add time' }),
      );
      const third = within(at).getByRole('group', { name: 'Time 3' });
      // An hour after the last row, and focus on its first part.
      expect(third).toHaveAccessibleDescription(/^6:30\sPM$/);
      await waitFor(() =>
        expect(
          within(third).getByRole('spinbutton', { name: 'Hours' }),
        ).toHaveFocus(),
      );
      // Typed back to 9:00 AM: a repeat, said under the row.
      await user.keyboard('900a');
      expect(third).toHaveAccessibleDescription(
        /Already in the list — it runs once\./,
      );
      // Remove 5:30 PM: focus lands on the row now in its place.
      await user.click(
        within(at).getByRole('button', { name: /^Remove 5:30\sPM$/ }),
      );
      await waitFor(() =>
        expect(
          within(within(at).getByRole('group', { name: 'Time 2' })).getByRole(
            'spinbutton',
            { name: 'Hours' },
          ),
        ).toHaveFocus(),
      );
      // The two 9:00 AM rows save as one.
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        frequency: 'weekly',
        interval: 1,
        weekdays: [1, 2, 3, 4, 5],
        times: ['09:00'],
      });
    });

    it('has no remove button with one time, and stops adding at the most', async () => {
      const { user } = render(
        <Required
          initial={{ frequency: 'daily', interval: 1, times: ['09:00'] }}
        />,
      );
      const dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom times' }),
      );
      const at = await within(dialog).findByRole('list', { name: 'At' });
      expect(within(at).queryByRole('button', { name: /^Remove/ })).toBeNull();
      const add = within(dialog).getByRole('button', { name: 'Add time' });
      for (let count = 1; count < 12; count += 1) await user.click(add);
      expect(within(at).getAllByRole('group')).toHaveLength(12);
      // Disabled with its reason, it stays focusable and says why.
      const full = within(dialog).getByRole('button', { name: 'Add time' });
      expect(full).toHaveAttribute('aria-disabled', 'true');
      full.focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Up to 12 times a day.',
      );
      await user.click(full);
      expect(within(at).getAllByRole('group')).toHaveLength(12);
    });

    it('discards the draft on Escape and saves it with Ctrl+Enter', async () => {
      const onChange = vi.fn();
      const { user } = render(<Required onChange={onChange} />);
      let dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom times' }),
      );
      await user.click(within(dialog).getByRole('radio', { name: 'Day' }));
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(onChange).not.toHaveBeenCalled();
      dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom times' }),
      );
      await user.click(within(dialog).getByRole('radio', { name: 'Day' }));
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        frequency: 'daily',
        interval: 1,
        times: ['09:00', '17:30'],
      });
    });
  });

  describe('Custom interval', () => {
    it('picks a grid with a window and saves it', async () => {
      const onChange = vi.fn();
      const { user } = render(<Required onChange={onChange} />);
      const dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom interval' }),
      );
      const every = await within(dialog).findByRole('combobox', {
        name: 'Every',
      });
      await waitFor(() => expect(every).toHaveFocus());
      expect(every).toHaveTextContent('15 minutes');
      await user.click(
        within(dialog).getByRole('button', { name: 'Saturday' }),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Sunday' }));
      await user.click(
        within(dialog).getByRole('checkbox', { name: 'Only between' }),
      );
      const from = within(dialog).getByRole('group', { name: 'From' });
      await waitFor(() =>
        expect(
          within(from).getByRole('spinbutton', { name: 'Hours' }),
        ).toHaveFocus(),
      );
      expect(
        plain(within(dialog).getByText(/^Each day, the first run/).textContent),
      ).toBe(
        'Each day, the first run starts at 8:00 AM and the last at 5:45 PM.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        frequency: 'minutely',
        interval: 15,
        window: {
          weekdays: [1, 2, 3, 4, 5],
          hours: { from: '08:00', to: '18:00' },
        },
      });
    });

    it('says when the hours run overnight or all day', async () => {
      const { user } = render(
        <Required
          initial={{
            frequency: 'minutely',
            interval: 30,
            window: {
              weekdays: [5],
              hours: { from: '22:00', to: '06:00' },
            },
          }}
        />,
      );
      const dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom interval' }),
      );
      expect(
        plain(within(dialog).getByText(/^Runs overnight/).textContent),
      ).toBe(
        'Runs overnight: the first starts at 10:00 PM, the last at 5:30 AM the next morning.',
      );
      const until = within(dialog).getByRole('group', { name: 'Until' });
      await user.click(
        within(until).getByRole('spinbutton', { name: 'Hours' }),
      );
      // Until 10:00 PM, the start: the same start and end.
      await user.keyboard('1000p');
      expect(
        within(dialog).getByText('The same start and end means all day.'),
      ).toBeVisible();
    });

    it('names a window’s one start once, and starts that all fall after midnight', async () => {
      const { user } = render(
        <Required
          initial={{
            frequency: 'hourly',
            interval: 6,
            minute: 0,
            window: {
              weekdays: [1, 2, 3, 4, 5],
              hours: { from: '08:00', to: '13:00' },
            },
          }}
        />,
      );
      const dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom interval' }),
      );
      expect(
        plain(within(dialog).getByText(/^Each day, it runs once/).textContent),
      ).toBe('Each day, it runs once, at 12:00 PM.');
      const from = within(dialog).getByRole('group', { name: 'From' });
      const until = within(dialog).getByRole('group', { name: 'Until' });
      // From 9:00 PM until 3:00 AM: every 6 hours starts only at midnight.
      await user.click(within(from).getByRole('spinbutton', { name: 'Hours' }));
      await user.keyboard('0900p');
      await user.click(
        within(until).getByRole('spinbutton', { name: 'Hours' }),
      );
      await user.keyboard('0300a');
      expect(
        plain(within(dialog).getByText(/^Each day, it runs once/).textContent),
      ).toBe('Each day, it runs once, at 12:00 AM the next morning.');
      // Every 2 hours from 11:00 PM: midnight and 2:00 AM, both after it.
      await user.click(within(dialog).getByRole('combobox', { name: 'Every' }));
      await user.click(screen.getByRole('option', { name: '2 hours' }));
      await user.click(within(from).getByRole('spinbutton', { name: 'Hours' }));
      await user.keyboard('1100p');
      expect(
        plain(within(dialog).getByText(/^Runs the next morning/).textContent),
      ).toBe(
        'Runs the next morning: the first starts at 12:00 AM, the last at 2:00 AM.',
      );
    });

    it('blocks Save, with its reason, while no run falls between the hours', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <Required
          onChange={onChange}
          initial={{
            frequency: 'hourly',
            interval: 6,
            minute: 0,
            window: {
              weekdays: [1, 2, 3, 4, 5],
              hours: { from: '08:00', to: '18:00' },
            },
          }}
        />,
      );
      const dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom interval' }),
      );
      const until = within(dialog).getByRole('group', { name: 'Until' });
      await user.click(
        within(until).getByRole('spinbutton', { name: 'Hours' }),
      );
      // 8:00 AM to 11:00 AM: every 6 hours from midnight starts at 6 and 12.
      await user.keyboard('1100a');
      const hint = within(dialog).getByText(/^No run falls between/);
      expect(hint).toHaveClass('text-destructive');
      expect(
        within(until).getByRole('spinbutton', { name: 'Hours' }),
      ).toHaveAttribute('aria-invalid', 'true');
      expect(until).toHaveAccessibleDescription(
        /No run falls between these times/,
      );
      // Enter will not save it, so the settled rule says why.
      await waitFor(() =>
        expect(
          within(dialog)
            .getAllByRole('status')
            .map((region) => plain(region.textContent)),
        ).toContainEqual(
          expect.stringMatching(
            /11:00 AM\. No run falls between these times\. Widen the hours or pick a shorter interval\.$/,
          ),
        ),
      );
      const save = within(dialog).getByRole('button', { name: 'Save' });
      expect(save).toHaveAttribute('aria-disabled', 'true');
      save.focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'No run falls between these times. Widen the hours or pick a shorter interval.',
      );
      await user.click(save);
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(onChange).not.toHaveBeenCalled();
      // Next runs are not shown for a rule that never runs.
      expect(
        within(dialog).queryByRole('list', { name: /^Next runs/ }),
      ).toBeNull();
    });

    it('asks for the minute past the hour once the step is in hours', async () => {
      const onChange = vi.fn();
      const { user } = render(<Required onChange={onChange} />);
      const dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('button', { name: 'Custom interval' }),
      );
      expect(
        within(dialog).queryByRole('spinbutton', { name: /past the hour/ }),
      ).toBeNull();
      await user.click(within(dialog).getByRole('combobox', { name: 'Every' }));
      await user.click(await screen.findByRole('option', { name: '2 hours' }));
      const minutePast = within(dialog).getByRole('spinbutton', {
        name: '0 minutes past the hour',
      });
      await user.click(minutePast);
      await user.keyboard('{PageUp}');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        frequency: 'hourly',
        interval: 2,
        minute: 15,
      });
    });
  });

  describe('a host option', () => {
    it('drafts and saves the extra with the rule', async () => {
      const onChange = vi.fn();
      function WithExtra() {
        const [value, setValue] = useState<ScheduleRule>(WEEKDAYS_TWICE);
        const [catchUp, setCatchUp] = useState(false);
        return (
          <RecurrencePicker<boolean, false>
            granularity="time"
            allowNever={false}
            value={value}
            reference={TUESDAY}
            extra={catchUp}
            nextOccurrences={(rule, extra) => {
              expect(typeof extra).toBe('boolean');
              return nextOccurrences(rule);
            }}
            onChange={(rule, next) => {
              setValue(rule);
              setCatchUp(next);
              onChange(rule, next);
            }}
            renderExtra={({ extra, setExtra }) => (
              <Checkbox
                label="Catch up missed runs"
                checked={extra}
                onCheckedChange={(checked) => setExtra(checked === true)}
              />
            )}
          />
        );
      }
      const { user } = render(<WithExtra />);
      const dialog = await openPicker(user);
      await user.click(
        within(dialog).getByRole('checkbox', { name: 'Catch up missed runs' }),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(WEEKDAYS_TWICE, true);
    });
  });
});
