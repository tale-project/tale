// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as repeatDates from '@/lib/shared/task-repeat';
import {
  localTimeZone,
  startOfCalendarDate,
  type TaskRepeat,
} from '@/lib/shared/task-repeat';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import * as repeatEdit from '../lib/task-repeat-edit';
import type { TaskRepeatFieldState } from '../lib/task-repeat-edit';
import { TaskRepeatField } from './task-repeat-field';

const zone = localTimeZone();

/** Midnight of a day in this runtime's zone — how a date picker stores it. */
function day(month: number, date: number, year = 2026): number {
  return startOfCalendarDate({ year, month, day: date }, zone);
}

const MONDAY = day(9, 28);
const TUESDAY = day(9, 29);

const weeklyMonday: TaskRepeat = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  timezone: zone,
};

const EDITABLE: TaskRepeatFieldState = { kind: 'editable' };

type Patch = { repeat: TaskRepeat | null; dueDate?: number };

function Harness({
  initial = null,
  dueDate,
  startDate,
  state = EDITABLE,
  onChange,
}: {
  initial?: TaskRepeat | null;
  dueDate?: number;
  startDate?: number;
  state?: TaskRepeatFieldState;
  onChange?: (patch: Patch) => void;
}) {
  const [value, setValue] = useState(initial);
  const [due, setDue] = useState(dueDate);
  return (
    <TaskRepeatField
      value={value}
      dueDate={due}
      startDate={startDate}
      state={state}
      onChange={(patch) => {
        onChange?.(patch);
        setValue(patch.repeat);
        if (patch.dueDate !== undefined) setDue(patch.dueDate);
      }}
    />
  );
}

async function openPicker(user: ReturnType<typeof render>['user']) {
  await user.click(screen.getByRole('button', { name: /^Repeat:/ }));
  return screen.findByRole('dialog', { name: 'Repeat' });
}

beforeEach(() => {
  // Monday, September 28 2026, mid-morning: "today" for every case below.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MONDAY + 10 * 3_600_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TaskRepeatField — writing a rule', () => {
  it('lists the next due dates the rule gives', async () => {
    const { user } = render(
      <Harness initial={weeklyMonday} dueDate={MONDAY} />,
    );
    const dialog = await openPicker(user);
    const dates = within(dialog).getByRole('list', { name: 'Next due dates' });
    expect(dates).toHaveTextContent('Mon, Oct 5 · Mon, Oct 12 · Mon, Oct 19');
    await checkAccessibility(document.body);
  });

  // A series needs a day to step from: a task with no due date gets the
  // first day the rule names, and a status line says so.
  it('dates a task without a due date, and announces it', async () => {
    const onChange = vi.fn();
    const { user } = render(<Harness onChange={onChange} />);
    const dialog = await openPicker(user);
    expect(dialog).toHaveTextContent(
      'No due date yet. Picking a repeat sets it to the first matching day.',
    );
    await user.click(
      within(dialog).getByRole('radio', { name: 'Weekly on Monday' }),
    );
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      repeat: weeklyMonday,
      dueDate: MONDAY,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'This task is now due on Mon, Sep 28.',
    );
  });

  it('keeps the zone an existing rule was set in', async () => {
    const elsewhere =
      zone === 'America/New_York' ? 'Europe/Zurich' : 'America/New_York';
    const onChange = vi.fn();
    const { user } = render(
      <Harness
        initial={{ ...weeklyMonday, timezone: elsewhere }}
        dueDate={MONDAY}
        onChange={onChange}
      />,
    );
    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Daily' }));
    expect(onChange).toHaveBeenCalledWith({
      repeat: { frequency: 'daily', interval: 1, timezone: elsewhere },
    });
  });

  it('stops the series from Never', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <Harness initial={weeklyMonday} dueDate={MONDAY} onChange={onChange} />,
    );
    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Never' }));
    expect(onChange).toHaveBeenCalledWith({ repeat: null });
    expect(
      screen.getByRole('button', { name: 'Repeat: Never' }),
    ).toBeInTheDocument();
  });
});

describe('TaskRepeatField — creating the next task on the due date', () => {
  it('saves the choice with the rule, and shows it on the trigger', async () => {
    const onChange = vi.fn();
    const { user, container } = render(
      <Harness initial={weeklyMonday} dueDate={TUESDAY} onChange={onChange} />,
    );
    expect(
      screen.getByRole('button', { name: /^Repeat:/ }),
    ).toHaveAccessibleDescription(
      'Weekly on Monday The next task is created when this one is done or cancelled.',
    );
    const dialog = await openPicker(user);
    const onDue = within(dialog).getByRole('checkbox', {
      name: 'Create the next task on the due date',
    });
    expect(onDue).toHaveAccessibleDescription(
      'Even if this one is still open on Tue, Sep 29.',
    );
    await user.click(onDue);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      repeat: { ...weeklyMonday, createOn: 'dueDate' },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Repeat:/ }),
      ).toHaveAccessibleDescription(
        'Weekly on Monday The next task is created on the due date, or sooner if this one is done or cancelled first.',
      ),
    );
    expect(container.querySelector('.lucide-calendar-sync')).not.toBeNull();
  });

  it('keeps the choice when a preset replaces the rule', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <Harness
        initial={{ ...weeklyMonday, createOn: 'dueDate' }}
        dueDate={MONDAY}
        onChange={onChange}
      />,
    );
    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Daily' }));
    expect(onChange).toHaveBeenCalledWith({
      repeat: {
        frequency: 'daily',
        interval: 1,
        timezone: zone,
        createOn: 'dueDate',
      },
    });
  });

  // The default mode is never stored: unticking writes the rule without it.
  it('drops the choice when unticked', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <Harness
        initial={{ ...weeklyMonday, createOn: 'dueDate' }}
        dueDate={TUESDAY}
        onChange={onChange}
      />,
    );
    const dialog = await openPicker(user);
    const onDue = within(dialog).getByRole('checkbox', {
      name: 'Create the next task on the due date',
    });
    expect(onDue).toBeChecked();
    await user.click(onDue);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenCalledWith({ repeat: weeklyMonday });
  });

  it('says the next task comes right away when the due date has begun', async () => {
    const { user } = render(
      <Harness initial={weeklyMonday} dueDate={MONDAY} />,
    );
    const dialog = await openPicker(user);
    expect(
      within(dialog).getByRole('checkbox', {
        name: 'Create the next task on the due date',
      }),
    ).toHaveAccessibleDescription(
      'This one is already due, so the next task is created right away.',
    );
  });

  // A new rule dates a task without a due date when it is saved: the date
  // it will get is the one the next task steps from.
  it('names the due date a new rule will set', async () => {
    const onChange = vi.fn();
    const { user } = render(<Harness onChange={onChange} />);
    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: 'Custom' }));
    expect(dialog).toHaveTextContent('This task becomes due on Mon, Sep 28.');
    expect(
      within(dialog).getByRole('checkbox', {
        name: 'Create the next task on the due date',
      }),
    ).toHaveAccessibleDescription(
      'This one is already due, so the next task is created right away.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: MONDAY }),
    );
  });

  // The saved rule on a task whose due date was cleared since: saving it
  // unchanged writes nothing, so no due date is promised — the next task
  // steps from the close. A change to the rule dates the task again.
  it('promises no due date for the saved rule, only for a change', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <Harness initial={weeklyMonday} onChange={onChange} />,
    );
    const dialog = await openPicker(user);
    expect(dialog).not.toHaveTextContent(/becomes due/);
    const onDue = within(dialog).getByRole('checkbox', {
      name: 'Create the next task on the due date',
    });
    expect(onDue).toHaveAccessibleDescription(
      'No due date: its next task is dated from the day this one closes.',
    );

    // Ticking it changes the rule; the box keeps its focus as its line
    // changes.
    await user.click(onDue);
    expect(onDue).toBeInTheDocument();
    expect(onDue).toHaveFocus();
    expect(dialog).toHaveTextContent('This task becomes due on Mon, Sep 28.');
    expect(dialog).not.toHaveTextContent(/No due date:/);
    expect(onDue).toHaveAccessibleDescription(
      'This one is already due, so the next task is created right away.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenCalledWith({
      repeat: { ...weeklyMonday, createOn: 'dueDate' },
      dueDate: MONDAY,
    });
  });
});

describe('TaskRepeatField — rows that cannot change', () => {
  it.each<[TaskRepeatFieldState, string]>([
    [
      { kind: 'locked', reason: 'automation' },
      "An automation runs this task, so it doesn't repeat.",
    ],
    [
      { kind: 'locked', reason: 'closed' },
      'Reopen this task to change how it repeats.',
    ],
    [
      { kind: 'locked', reason: 'continued', nextTask: 'OPS-8' },
      'This series continues on OPS-8. Change the repeat there.',
    ],
    [
      { kind: 'locked', reason: 'continued' },
      'This series continues on its next task. Change the repeat there.',
    ],
    [{ kind: 'locked', reason: 'notOpen' }, 'Only open tasks repeat.'],
  ])('explains a %o row, and opens nothing', async (state, reason) => {
    const { user } = render(<Harness state={state} />);
    const trigger = screen.getByRole('button', { name: 'Repeat: Never' });
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(trigger).toHaveAccessibleDescription(reason);
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a locked rule readable, with the mode and the reason', () => {
    render(
      <Harness
        initial={weeklyMonday}
        dueDate={MONDAY}
        state={{ kind: 'locked', reason: 'closed' }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Repeat: Weekly, Mon' }),
    ).toHaveAccessibleDescription(
      'Weekly on Monday The next task is created when this one is done or cancelled. Reopen this task to change how it repeats.',
    );
  });

  // A subtask has no rule of its own; it comes back with its parent.
  it('says a subtask comes back with its repeating parent', async () => {
    const { user } = render(
      <Harness
        state={{ kind: 'locked', reason: 'subtask', parent: 'OPS-3' }}
      />,
    );
    const line = screen.getByRole('button', { name: 'Repeat: With OPS-3' });
    expect(line).toHaveTextContent('With OPS-3');
    expect(line).toHaveAttribute('aria-disabled', 'true');
    expect(line).toHaveAccessibleDescription(
      'This subtask comes back with OPS-3: each time OPS-3 repeats, its next task gets a fresh copy of it.',
    );
    await user.click(line);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await checkAccessibility(document.body);
  });

  it('shows the rule as text without the right to change it', () => {
    render(
      <Harness
        initial={weeklyMonday}
        dueDate={MONDAY}
        state={{ kind: 'readOnly' }}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Weekly on Monday')).toBeInTheDocument();
  });

  it('renders nothing when hidden', () => {
    const { container } = render(<Harness state={{ kind: 'hidden' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TaskRepeatField — exhausted calendar range', () => {
  it('keeps a saved rule editable when its preview cannot be represented', async () => {
    vi.spyOn(repeatDates, 'upcomingTaskRepeatDates').mockImplementation(() => {
      throw new RangeError(
        'The repeat date is outside the supported calendar range',
      );
    });
    const onChange = vi.fn();
    const { user } = render(
      <Harness initial={weeklyMonday} dueDate={MONDAY} onChange={onChange} />,
    );
    const picker = await openPicker(user);
    expect(
      within(picker).getByText(
        'Upcoming dates are outside the supported calendar range. Choose an earlier date.',
      ),
    ).toBeInTheDocument();
    expect(within(picker).queryByRole('list')).not.toBeInTheDocument();
    await user.click(within(picker).getByRole('radio', { name: 'Never' }));
    expect(onChange).toHaveBeenCalledWith({ repeat: null });
  });

  it('handles an actual valid far-future date whose next recurrence overflows', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <Harness
        initial={{
          frequency: 'monthly',
          interval: 99,
          monthDay: 31,
          timezone: 'UTC',
        }}
        dueDate={Date.UTC(275760, 7, 31)}
        onChange={onChange}
      />,
    );
    const picker = await openPicker(user);
    expect(
      within(picker).getByText(
        'Upcoming dates are outside the supported calendar range. Choose an earlier date.',
      ),
    ).toBeInTheDocument();
    await user.click(within(picker).getByRole('radio', { name: 'Never' }));
    expect(onChange).toHaveBeenCalledWith({ repeat: null });
  });

  it('refuses a new due date outside the calendar range without throwing', async () => {
    vi.spyOn(repeatEdit, 'taskRepeatPatch').mockImplementation(() => {
      throw new RangeError(
        'The repeat date is outside the supported calendar range',
      );
    });
    const onChange = vi.fn();
    const { user } = render(<Harness onChange={onChange} />);
    const picker = await openPicker(user);
    await user.click(within(picker).getByRole('radio', { name: 'Daily' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Upcoming dates are outside the supported calendar range. Choose an earlier date.',
    );
    expect(
      screen.getByRole('button', { name: 'Repeat: Never' }),
    ).toBeInTheDocument();
  });
});
