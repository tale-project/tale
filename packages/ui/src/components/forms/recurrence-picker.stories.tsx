import type { Meta, StoryObj } from '@storybook/react';
import { CalendarSync } from 'lucide-react';
import { useState } from 'react';

import type {
  CalendarDay,
  RecurrenceReference,
  RecurrenceRule,
} from '../../lib/recurrence/rule';
import { InLocale } from '../../storybook/in-locale';
import { TooltipProvider } from '../overlays/tooltip';
import { Checkbox } from './checkbox';
import { RecurrencePicker } from './recurrence-picker';

/** Tue Sep 29, 2026. */
const REFERENCE: RecurrenceReference = {
  year: 2026,
  month: 9,
  day: 29,
  weekday: 2,
};

const DAY_MS = 86_400_000;

function toDay(ms: number): CalendarDay {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/**
 * A toy stand-in for a host's calendar arithmetic: walks the days after the
 * reference and keeps the first three the rule names. A real host steps in
 * its own time zone and decides what a short month does with the 31st.
 */
function toyNextDates(rule: RecurrenceRule): CalendarDay[] {
  const start = Date.UTC(REFERENCE.year, REFERENCE.month - 1, REFERENCE.day);
  const found: CalendarDay[] = [];
  for (let offset = 1; offset < 3 * 366 && found.length < 3; offset++) {
    const ms = start + offset * DAY_MS;
    const date = new Date(ms);
    const months =
      (date.getUTCFullYear() - REFERENCE.year) * 12 +
      date.getUTCMonth() +
      1 -
      REFERENCE.month;
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    let matches = false;
    switch (rule.frequency) {
      case 'daily':
        matches = offset % rule.interval === 0;
        break;
      case 'weekly':
        matches =
          rule.weekdays.includes(date.getUTCDay()) &&
          Math.floor((offset + ((REFERENCE.weekday + 6) % 7)) / 7) %
            rule.interval ===
            0;
        break;
      case 'monthly':
        matches =
          months % rule.interval === 0 &&
          date.getUTCDate() === Math.min(rule.monthDay, lastDay);
        break;
      case 'yearly':
        matches =
          (date.getUTCFullYear() - REFERENCE.year) % rule.interval === 0 &&
          date.getUTCMonth() + 1 === rule.month &&
          date.getUTCDate() === Math.min(rule.monthDay, lastDay);
        break;
    }
    if (matches) found.push(toDay(ms));
  }
  return found;
}

function PickerRender({
  initial = null,
  width = 192,
  withDates = false,
  ...rest
}: {
  initial?: RecurrenceRule | null;
  width?: number;
  withDates?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  readOnly?: boolean;
  description?: string;
}) {
  const [value, setValue] = useState<RecurrenceRule | null>(initial);
  return (
    <div style={{ width }}>
      <RecurrencePicker
        value={value}
        reference={REFERENCE}
        nextDates={withDates ? toyNextDates : undefined}
        onChange={setValue}
        {...rest}
      />
    </div>
  );
}

function ExtraRender() {
  const [value, setValue] = useState<RecurrenceRule | null>({
    frequency: 'monthly',
    interval: 1,
    monthDay: 30,
  });
  const [onDue, setOnDue] = useState(false);
  return (
    <div style={{ width: 192 }}>
      <RecurrencePicker<boolean>
        value={value}
        reference={REFERENCE}
        icon={onDue ? CalendarSync : undefined}
        description={
          onDue
            ? 'The next task is created on the due date.'
            : 'The next task is created when this one is done.'
        }
        nextDates={toyNextDates}
        nextDatesLabel="Next due dates"
        extra={onDue}
        onChange={(rule, next) => {
          setValue(rule);
          setOnDue(next);
        }}
        renderExtra={({ rule, extra, setExtra }) =>
          rule ? (
            <Checkbox
              label="Create the next task on the due date"
              description="Even if this one is still open on Tue, Sep 29."
              checked={extra}
              onCheckedChange={(checked) => setExtra(checked === true)}
            />
          ) : null
        }
      />
    </div>
  );
}

const meta: Meta<typeof RecurrencePicker> = {
  title: 'Forms/RecurrencePicker',
  component: RecurrencePicker,
  tags: ['autodocs'],
  // The trigger's tooltip needs a provider; the app gets one from `AppShell`.
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
How something repeats: a compact trigger that opens one-click presets read
off a reference day, and a Custom view that edits any rule in place.

\`\`\`tsx
import { RecurrencePicker } from '@tale/ui/recurrence-picker';

<RecurrencePicker value={rule} reference={dueDay} onChange={setRule} />
\`\`\`

- A preset saves and closes at once; custom edits and the host's extra are a
  draft that **Save** commits once and Escape throws away.
- The package does no calendar arithmetic: the host passes the reference day
  (with its weekday) and, to show them, the next dates a rule produces.
- The trigger's name is "Repeat: " plus the visible rule; a tail that does not
  fit the column drops out whole.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof RecurrencePicker>;

export const Never: Story = {
  render: () => <PickerRender />,
};

export const Weekly: Story = {
  render: () => (
    <PickerRender
      initial={{ frequency: 'weekly', interval: 1, weekdays: [2] }}
    />
  ),
};

export const CustomRule: Story = {
  render: () => (
    <PickerRender
      initial={{ frequency: 'weekly', interval: 2, weekdays: [2, 4] }}
    />
  ),
};

export const WithNextDates: Story = {
  render: () => (
    <PickerRender
      withDates
      initial={{ frequency: 'monthly', interval: 1, monthDay: 31 }}
    />
  ),
};

export const WithExtra: Story = {
  render: () => <ExtraRender />,
};

export const Disabled: Story = {
  render: () => (
    <PickerRender
      initial={{ frequency: 'monthly', interval: 1, monthDay: 30 }}
      description="The next task is created when this one is done."
      disabled
      disabledReason="Reopen this task to change how it repeats."
    />
  ),
};

export const ReadOnly: Story = {
  render: () => (
    <PickerRender
      readOnly
      initial={{ frequency: 'yearly', interval: 1, month: 9, monthDay: 30 }}
    />
  ),
};

export const Narrow128px: Story = {
  render: () => (
    <PickerRender
      width={128}
      initial={{ frequency: 'weekly', interval: 1, weekdays: [2, 4] }}
    />
  ),
};

export const German: Story = {
  render: () => (
    <InLocale locale="de">
      <PickerRender
        withDates
        initial={{ frequency: 'weekly', interval: 2, weekdays: [2, 4] }}
      />
    </InLocale>
  ),
};

export const French: Story = {
  render: () => (
    <InLocale locale="fr">
      <PickerRender
        withDates
        initial={{ frequency: 'monthly', interval: 1, monthDay: 1 }}
      />
    </InLocale>
  ),
};
