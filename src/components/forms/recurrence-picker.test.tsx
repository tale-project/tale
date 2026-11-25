import userEvent from '@testing-library/user-event';
import { CalendarSync } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type {
  CalendarDay,
  RecurrenceReference,
  RecurrenceRule,
} from '../../lib/recurrence/rule';
import { Checkbox } from './checkbox';
import {
  RecurrencePicker,
  type RecurrencePickerProps,
} from './recurrence-picker';

/** Tue Sep 29, 2026. */
const TUESDAY: RecurrenceReference = {
  year: 2026,
  month: 9,
  day: 29,
  weekday: 2,
};

const WEEKLY_TUESDAY: RecurrenceRule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [2],
};

type PlainProps = Extract<
  RecurrencePickerProps,
  { onChange: (rule: RecurrenceRule | null) => void }
>;

function Harness({
  initial = null,
  onChange,
  ...rest
}: Partial<Omit<PlainProps, 'value' | 'onChange'>> & {
  initial?: RecurrenceRule | null;
  onChange?: (rule: RecurrenceRule | null) => void;
}) {
  const [value, setValue] = useState<RecurrenceRule | null>(initial);
  return (
    <RecurrencePicker
      reference={TUESDAY}
      {...rest}
      value={value}
      onChange={(rule) => {
        setValue(rule);
        onChange?.(rule);
      }}
    />
  );
}

/** A host option: create the next item on the due date. */
function ExtraHarness({
  initial = WEEKLY_TUESDAY,
  onChange,
}: {
  initial?: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null, onDue: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [onDue, setOnDue] = useState(false);
  return (
    <RecurrencePicker<boolean>
      value={value}
      reference={TUESDAY}
      extra={onDue}
      onChange={(rule, nextOnDue) => {
        setValue(rule);
        setOnDue(nextOnDue);
        onChange(rule, nextOnDue);
      }}
      renderExtra={({ rule, extra, setExtra }) =>
        rule ? (
          <Checkbox
            label="Create the next task on the due date"
            checked={extra}
            onCheckedChange={(checked) => setExtra(checked === true)}
          />
        ) : null
      }
    />
  );
}

/** Every Tuesday from Oct 6 on, as a host's calendar would step it. */
function weeklyDates(rule: RecurrenceRule): CalendarDay[] {
  return rule.frequency === 'daily'
    ? []
    : [6, 13, 20, 27].map((day) => ({ year: 2026, month: 10, day }));
}

async function openPicker(
  user: ReturnType<typeof render>['user'],
  name: RegExp | string,
) {
  await user.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name: 'Repeat' });
}

describe('RecurrencePicker', () => {
  describe('trigger', () => {
    it('is named by the hidden prefix and the visible compact rule', () => {
      render(
        <Harness
          initial={{ frequency: 'weekly', interval: 2, weekdays: [2, 4] }}
        />,
      );
      const trigger = screen.getByRole('button', {
        name: 'Repeat: Every 2 weeks, Tue, Thu',
      });
      expect(trigger).toHaveTextContent('Every 2 weeks · Tue, Thu');
      expect(trigger).toHaveAccessibleDescription(
        'Every 2 weeks on Tuesday and Thursday',
      );
      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('reads Never, muted, with no description', () => {
      render(<Harness />);
      const trigger = screen.getByRole('button', { name: 'Repeat: Never' });
      expect(trigger).not.toHaveAttribute('aria-describedby');
      expect(within(trigger).getByText('Never')).toHaveClass(
        'text-muted-foreground',
      );
    });

    it('adds the host description, and a lock reason, to the description', () => {
      const { rerender } = render(
        <RecurrencePicker
          value={WEEKLY_TUESDAY}
          reference={TUESDAY}
          label="Repeat"
          description="The next task is created when this one is closed."
          onChange={() => {}}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Repeat: Weekly, Tue' }),
      ).toHaveAccessibleDescription(
        'Weekly on Tuesday The next task is created when this one is closed.',
      );
      rerender(
        <RecurrencePicker
          value={WEEKLY_TUESDAY}
          reference={TUESDAY}
          description="The next task is created when this one is closed."
          disabled
          disabledReason="Reopen this task to change how it repeats."
          onChange={() => {}}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Repeat: Weekly, Tue' }),
      ).toHaveAccessibleDescription(
        'Weekly on Tuesday The next task is created when this one is closed. Reopen this task to change how it repeats.',
      );
    });

    it('shows the full rule in a tooltip on focus, never over the open popover', async () => {
      const { user } = render(
        <>
          <button type="button">Before</button>
          <Harness
            initial={{ frequency: 'weekly', interval: 2, weekdays: [2, 4] }}
            description="The next task is created when this one is done."
          />
        </>,
      );
      await user.click(screen.getByRole('button', { name: 'Before' }));
      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent(
        'Every 2 weeks on Tuesday and ThursdayThe next task is created when this one is done.',
      );
      await user.keyboard('{Enter}');
      await screen.findByRole('dialog', { name: 'Repeat' });
      await waitFor(() =>
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
      );
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Repeat/ })).toHaveFocus(),
      );
      // Focus coming back from the popover does not reopen the tip.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('takes its label and icon from the host', () => {
      const { container } = render(
        <Harness
          initial={WEEKLY_TUESDAY}
          label="Recurrence"
          icon={CalendarSync}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Recurrence: Weekly, Tue' }),
      ).toBeVisible();
      expect(container.querySelector('.lucide-calendar-sync')).not.toBeNull();
    });
  });

  describe('presets', () => {
    it('opens on the checked preset with the rows read off the reference', async () => {
      const { user } = render(<Harness initial={WEEKLY_TUESDAY} />);
      const dialog = await openPicker(user, /Repeat/);
      const presets = within(dialog).getByRole('radiogroup', {
        name: 'Presets',
      });
      expect(
        within(presets)
          .getAllByRole('radio')
          .map((row) => row.textContent),
      ).toEqual([
        'Never',
        'Daily',
        'Every weekdayMon–Fri',
        'Weekly on Tuesday',
        'Monthly on day 29',
        'Yearly on Sep 29',
      ]);
      const weekly = within(presets).getByRole('radio', {
        name: 'Weekly on Tuesday',
      });
      expect(weekly).toHaveAttribute('aria-checked', 'true');
      await waitFor(() => expect(weekly).toHaveFocus());
      // Clean: no footer.
      expect(
        within(dialog).queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument();
      await checkAccessibility(document.body);
    });

    it('saves a preset once, closes and returns focus to the trigger', async () => {
      const onChange = vi.fn();
      const { user } = render(<Harness onChange={onChange} />);
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('radio', { name: 'Daily' }));
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith({
        frequency: 'daily',
        interval: 1,
      });
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Repeat: Daily' }),
        ).toHaveFocus(),
      );
    });

    it('calls nothing when the current preset is picked again', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <Harness initial={WEEKLY_TUESDAY} onChange={onChange} />,
      );
      const dialog = await openPicker(user, /Repeat/);
      await user.click(
        within(dialog).getByRole('radio', { name: 'Weekly on Tuesday' }),
      );
      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });

    it('gives null for Never, and nothing when there was no rule', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <Harness initial={WEEKLY_TUESDAY} onChange={onChange} />,
      );
      let dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('radio', { name: 'Never' }));
      expect(onChange).toHaveBeenCalledWith(null);
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      onChange.mockClear();
      dialog = await openPicker(user, 'Repeat: Never');
      await user.click(within(dialog).getByRole('radio', { name: 'Never' }));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('moves between rows with the arrow keys and saves with Enter', async () => {
      const onChange = vi.fn();
      const { user } = render(<Harness onChange={onChange} />);
      const dialog = await openPicker(user, /Repeat/);
      await waitFor(() =>
        expect(
          within(dialog).getByRole('radio', { name: 'Never' }),
        ).toHaveFocus(),
      );
      await user.keyboard('{ArrowDown}{ArrowDown}');
      expect(
        within(dialog).getByRole('radio', { name: /Every weekday/ }),
      ).toHaveFocus();
      // Arrows never select: selecting saves.
      expect(onChange).not.toHaveBeenCalled();
      await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
      expect(
        within(dialog).getByRole('radio', { name: 'Yearly on Sep 29' }),
      ).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(onChange).toHaveBeenCalledWith({
        frequency: 'yearly',
        interval: 1,
        month: 9,
        monthDay: 29,
      });
    });

    it('lists only the presets it is given, Never always first', async () => {
      const { user } = render(<Harness presets={['weekly', 'monthly']} />);
      const dialog = await openPicker(user, /Repeat/);
      expect(
        within(dialog)
          .getAllByRole('radio')
          .map((row) => row.textContent),
      ).toEqual(['Never', 'Weekly on Tuesday', 'Monthly on day 29']);
    });
  });

  describe('custom rule', () => {
    it('drafts in place and saves once', async () => {
      const onChange = vi.fn();
      const { user } = render(<Harness onChange={onChange} />);
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      expect(
        within(dialog).getByRole('heading', { name: 'Custom' }),
      ).toBeVisible();
      await waitFor(() =>
        expect(
          within(dialog).getByRole('radio', { name: 'Week' }),
        ).toHaveFocus(),
      );
      await user.click(
        within(dialog).getByRole('button', { name: 'Thursday' }),
      );
      await user.click(
        within(dialog).getByRole('spinbutton', { name: 'Every 1 week' }),
      );
      await user.keyboard('{ArrowUp}');
      expect(onChange).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith({
        frequency: 'weekly',
        interval: 2,
        weekdays: [2, 4],
      });
      expect(
        await screen.findByRole('button', {
          name: 'Repeat: Every 2 weeks, Tue, Thu',
        }),
      ).toBeVisible();
    });

    it('marks a saved custom rule on the Custom row', async () => {
      const { user } = render(
        <Harness
          initial={{ frequency: 'weekly', interval: 2, weekdays: [2, 4] }}
        />,
      );
      const dialog = await openPicker(user, /Repeat/);
      const custom = within(dialog).getByRole('button', { name: 'Custom' });
      expect(custom).toHaveAccessibleDescription(
        'Every 2 weeks on Tuesday and Thursday',
      );
      await waitFor(() => expect(custom).toHaveFocus());
      expect(
        within(dialog)
          .getAllByRole('radio')
          .filter((row) => row.getAttribute('aria-checked') === 'true'),
      ).toEqual([]);
    });

    it.each([
      [
        'Cancel',
        async (user: ReturnType<typeof render>['user']) => {
          await user.click(screen.getByRole('button', { name: 'Cancel' }));
        },
      ],
      [
        'Escape',
        async (user: ReturnType<typeof render>['user']) => {
          await user.keyboard('{Escape}');
        },
      ],
    ])('throws the draft away on %s', async (_, dismiss) => {
      const onChange = vi.fn();
      const { user } = render(
        <Harness initial={WEEKLY_TUESDAY} onChange={onChange} />,
      );
      let dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      await user.click(within(dialog).getByRole('radio', { name: 'Month' }));
      await dismiss(user);
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(onChange).not.toHaveBeenCalled();
      dialog = await openPicker(user, /Repeat/);
      expect(
        within(dialog).getByRole('radio', { name: 'Weekly on Tuesday' }),
      ).toHaveAttribute('aria-checked', 'true');
    });

    it('throws the draft away on a click outside', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <>
          <button type="button">Elsewhere</button>
          <Harness initial={WEEKLY_TUESDAY} onChange={onChange} />
        </>,
      );
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      await user.click(within(dialog).getByRole('radio', { name: 'Day' }));
      // The modal popover makes the page inert to the pointer; a press
      // outside still reaches its dismiss handler.
      await userEvent
        .setup({ pointerEventsCheck: 0 })
        .click(screen.getByRole('button', { name: 'Elsewhere', hidden: true }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the draft on Back, checks the preset it now equals, and shows the footer', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <Harness initial={WEEKLY_TUESDAY} onChange={onChange} />,
      );
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      await user.click(within(dialog).getByRole('radio', { name: 'Month' }));
      await user.click(
        within(dialog).getByRole('button', { name: 'Back to presets' }),
      );
      await waitFor(() =>
        expect(
          within(dialog).getByRole('button', { name: 'Custom' }),
        ).toHaveFocus(),
      );
      expect(
        within(dialog).getByRole('radio', { name: 'Monthly on day 29' }),
      ).toHaveAttribute('aria-checked', 'true');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenCalledWith({
        frequency: 'monthly',
        interval: 1,
        monthDay: 29,
      });
    });

    it('saves with Enter in a number field and with Ctrl+Enter', async () => {
      const onChange = vi.fn();
      const { user } = render(<Harness onChange={onChange} />);
      let dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      const interval = within(dialog).getByRole('spinbutton', {
        name: 'Every 1 week',
      });
      await user.clear(interval);
      await user.type(interval, '3{Enter}');
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenLastCalledWith({
        frequency: 'weekly',
        interval: 3,
        weekdays: [2],
      });
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );

      dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      await user.click(within(dialog).getByRole('radio', { name: 'Day' }));
      expect(
        within(dialog).getByRole('button', { name: 'Save' }),
      ).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith({
        frequency: 'daily',
        interval: 3,
      });
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );

      // Cmd+Enter on a Mac, from the host's option in the preset view.
      dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('radio', { name: 'Never' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      await user.click(within(dialog).getByRole('radio', { name: 'Month' }));
      await user.keyboard('{Meta>}{Enter}{/Meta}');
      expect(onChange).toHaveBeenLastCalledWith({
        frequency: 'monthly',
        interval: 1,
        monthDay: 29,
      });
    });

    it('never submits the host form around it', async () => {
      const onSubmit = vi.fn((event: { preventDefault: () => void }) =>
        event.preventDefault(),
      );
      const onChange = vi.fn();
      const { user } = render(
        <form onSubmit={onSubmit}>
          <Harness onChange={onChange} />
        </form>,
      );
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      await user.type(
        within(dialog).getByRole('spinbutton', { name: 'Every 1 week' }),
        '{Enter}',
      );
      expect(onChange).toHaveBeenCalledOnce();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('offers only the given units and step', async () => {
      const { user } = render(
        <Harness frequencies={['weekly', 'monthly']} maxInterval={12} />,
      );
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      expect(
        within(within(dialog).getByRole('radiogroup', { name: 'Unit' }))
          .getAllByRole('radio')
          .map((radio) => radio.textContent),
      ).toEqual(['Week', 'Month']);
      expect(
        within(dialog).getByRole('spinbutton', { name: 'Every 1 week' }),
      ).toHaveAttribute('aria-valuemax', '12');
    });

    it('passes axe in the Custom view', async () => {
      const { user } = render(<Harness nextDates={weeklyDates} />);
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      await checkAccessibility(document.body);
    });
  });

  describe('host extra', () => {
    it('drafts the extra and saves it with the rule', async () => {
      const onChange = vi.fn();
      const { user } = render(<ExtraHarness onChange={onChange} />);
      const dialog = await openPicker(user, /Repeat/);
      const box = within(dialog).getByRole('checkbox', {
        name: 'Create the next task on the due date',
      });
      await user.click(box);
      expect(onChange).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith(WEEKLY_TUESDAY, true);
    });

    it('saves a preset with the drafted extra', async () => {
      const onChange = vi.fn();
      const { user } = render(<ExtraHarness onChange={onChange} />);
      const dialog = await openPicker(user, /Repeat/);
      await user.click(
        within(dialog).getByRole('checkbox', {
          name: 'Create the next task on the due date',
        }),
      );
      await user.click(within(dialog).getByRole('radio', { name: 'Daily' }));
      expect(onChange).toHaveBeenCalledWith(
        { frequency: 'daily', interval: 1 },
        true,
      );
    });

    it('saves the current preset when only the extra changed', async () => {
      const onChange = vi.fn();
      const { user } = render(<ExtraHarness onChange={onChange} />);
      const dialog = await openPicker(user, /Repeat/);
      await user.click(
        within(dialog).getByRole('checkbox', {
          name: 'Create the next task on the due date',
        }),
      );
      await user.click(
        within(dialog).getByRole('radio', { name: 'Weekly on Tuesday' }),
      );
      expect(onChange).toHaveBeenCalledWith(WEEKLY_TUESDAY, true);
    });

    it('hides the details section when the host renders nothing', async () => {
      const { user } = render(
        <ExtraHarness initial={null} onChange={() => {}} />,
      );
      const dialog = await openPicker(user, /Repeat/);
      expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('next dates', () => {
    it('lists at most three dates for the draft rule', async () => {
      const { user } = render(
        <Harness initial={WEEKLY_TUESDAY} nextDates={weeklyDates} />,
      );
      const dialog = await openPicker(user, /Repeat/);
      const list = within(dialog).getByRole('list', { name: 'Next dates' });
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['Tue, Oct 6', ' · Tue, Oct 13', ' · Tue, Oct 20']);
    });

    it('takes the host’s heading for the dates', async () => {
      const { user } = render(
        <Harness
          initial={WEEKLY_TUESDAY}
          nextDates={weeklyDates}
          nextDatesLabel="Next due dates"
        />,
      );
      const dialog = await openPicker(user, /Repeat/);
      expect(
        within(dialog).getByRole('list', { name: 'Next due dates' }),
      ).toBeVisible();
    });

    it('shows no dates without nextDates, or when it returns none', async () => {
      const { user } = render(
        <Harness initial={{ frequency: 'daily', interval: 1 }} />,
      );
      let dialog = await openPicker(user, /Repeat/);
      expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      render(
        <Harness
          label="Other"
          initial={{ frequency: 'daily', interval: 1 }}
          nextDates={weeklyDates}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^Other/ }));
      dialog = await screen.findByRole('dialog', { name: 'Other' });
      expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('unavailable states', () => {
    it('stays focusable when locked with a reason, and opens nothing', async () => {
      const { user } = render(
        <Harness
          initial={WEEKLY_TUESDAY}
          disabled
          disabledReason="Reopen this task to change how it repeats."
        />,
      );
      const trigger = screen.getByRole('button', {
        name: 'Repeat: Weekly, Tue',
      });
      expect(trigger).toHaveAttribute('aria-disabled', 'true');
      expect(trigger).not.toBeDisabled();
      await user.tab();
      expect(trigger).toHaveFocus();
      await user.keyboard('{Enter}');
      await user.click(trigger);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('is natively disabled without a reason', () => {
      render(<Harness initial={WEEKLY_TUESDAY} disabled />);
      expect(
        screen.getByRole('button', { name: 'Repeat: Weekly, Tue' }),
      ).toBeDisabled();
    });

    it('renders plain text when read-only', () => {
      render(
        <Harness
          initial={{ frequency: 'weekly', interval: 2, weekdays: [2, 4] }}
          readOnly
        />,
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(
        screen.getByText('Every 2 weeks on Tuesday and Thursday'),
      ).toHaveClass('sr-only');
      expect(screen.getByText('Every 2 weeks')).toBeVisible();
    });

    it('closes and discards the draft when it turns disabled while open', async () => {
      const onChange = vi.fn();
      function Toggle() {
        const [locked, setLocked] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setLocked(true)}>
              Lock
            </button>
            <RecurrencePicker
              value={WEEKLY_TUESDAY}
              reference={TUESDAY}
              disabled={locked}
              disabledReason="Locked"
              onChange={onChange}
            />
          </>
        );
      }
      const { user } = render(<Toggle />);
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      // The popover is modal; flip the prop from outside the pointer's reach.
      screen.getByRole('button', { name: 'Lock', hidden: true }).click();
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(onChange).not.toHaveBeenCalled();
      // Focus lands on the locked trigger, not on the page.
      expect(
        screen.getByRole('button', { name: 'Repeat: Weekly, Tue' }),
      ).toHaveFocus();
    });
  });

  describe('saved values changing while open', () => {
    function Controlled({
      value,
      onChange = () => {},
    }: {
      value: RecurrenceRule | null;
      onChange?: (rule: RecurrenceRule | null) => void;
    }) {
      return (
        <RecurrencePicker
          value={value}
          reference={TUESDAY}
          onChange={onChange}
        />
      );
    }

    it('lets a clean draft follow the new value', async () => {
      const { user, rerender } = render(<Controlled value={WEEKLY_TUESDAY} />);
      const dialog = await openPicker(user, /Repeat/);
      rerender(<Controlled value={{ frequency: 'daily', interval: 1 }} />);
      await waitFor(() =>
        expect(
          within(dialog).getByRole('radio', { name: 'Daily' }),
        ).toHaveAttribute('aria-checked', 'true'),
      );
      expect(
        within(dialog).queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument();
    });

    it('keeps a dirty draft', async () => {
      const onChange = vi.fn();
      const { user, rerender } = render(
        <Controlled value={WEEKLY_TUESDAY} onChange={onChange} />,
      );
      const dialog = await openPicker(user, /Repeat/);
      await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
      await user.click(within(dialog).getByRole('radio', { name: 'Month' }));
      rerender(
        <Controlled
          value={{ frequency: 'daily', interval: 1 }}
          onChange={onChange}
        />,
      );
      expect(
        within(dialog).getByRole('radio', { name: 'Month' }),
      ).toHaveAttribute('aria-checked', 'true');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenCalledWith({
        frequency: 'monthly',
        interval: 1,
        monthDay: 29,
      });
    });
  });
});
