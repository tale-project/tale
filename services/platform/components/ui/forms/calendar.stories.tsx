import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Calendar } from './calendar';
import { addDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';

const meta: Meta<typeof Calendar> = {
  title: 'Forms/Calendar',
  component: Calendar,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A calendar component built on react-day-picker for date selection.

## Usage
\`\`\`tsx
import { Calendar } from '@/components/ui/forms/calendar';

const [date, setDate] = useState<Date | undefined>(new Date());

<Calendar
  mode="single"
  selected={date}
  onSelect={setDate}
/>
\`\`\`

## Accessibility
- Full keyboard navigation
- ARIA roles for calendar grid
- Screen reader announcements for date selection
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Calendar>;

export const Default: Story = {
  render: function Render() {
    const [date, setDate] = useState<Date | undefined>(new Date());
    return (
      <Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
        className="rounded-md border"
      />
    );
  },
};

export const WithSelectedDate: Story = {
  render: function Render() {
    const [date, setDate] = useState<Date | undefined>(new Date());
    return (
      <div className="space-y-4">
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
          className="rounded-md border"
        />
        <p className="text-sm text-muted-foreground text-center">
          Selected: {date?.toLocaleDateString() || 'None'}
        </p>
      </div>
    );
  },
};

export const RangeSelection: Story = {
  render: function Render() {
    const [range, setRange] = useState<DateRange | undefined>({
      from: new Date(),
      to: addDays(new Date(), 7),
    });
    return (
      <div className="space-y-4">
        <Calendar
          mode="range"
          selected={range}
          onSelect={setRange}
          className="rounded-md border"
          numberOfMonths={2}
        />
        <p className="text-sm text-muted-foreground text-center">
          {range?.from?.toLocaleDateString()} - {range?.to?.toLocaleDateString()}
        </p>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Range mode allows selecting a start and end date.',
      },
    },
  },
};

export const MultipleMonths: Story = {
  render: function Render() {
    const [date, setDate] = useState<Date | undefined>(new Date());
    return (
      <Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
        className="rounded-md border"
        numberOfMonths={2}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Display multiple months for easier navigation.',
      },
    },
  },
};

export const DisabledDates: Story = {
  render: function Render() {
    const [date, setDate] = useState<Date | undefined>(new Date());
    const today = new Date();
    return (
      <Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
        className="rounded-md border"
        disabled={(date) => date < today || date > addDays(today, 30)}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Disable dates outside a valid range (next 30 days in this example).',
      },
    },
  },
};

export const DisableWeekends: Story = {
  render: function Render() {
    const [date, setDate] = useState<Date | undefined>(new Date());
    return (
      <Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
        className="rounded-md border"
        disabled={(date) => date.getDay() === 0 || date.getDay() === 6}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Disable weekend days for business day selection.',
      },
    },
  },
};

export const HideOutsideDays: Story = {
  render: function Render() {
    const [date, setDate] = useState<Date | undefined>(new Date());
    return (
      <Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
        className="rounded-md border"
        showOutsideDays={false}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Hide days from adjacent months for cleaner display.',
      },
    },
  },
};

export const WithFooter: Story = {
  render: function Render() {
    const [date, setDate] = useState<Date | undefined>(new Date());
    return (
      <div className="rounded-md border p-4">
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
        />
        <div className="border-t pt-3 mt-3 flex justify-between">
          <button
            onClick={() => setDate(new Date())}
            className="text-sm text-primary hover:underline"
          >
            Today
          </button>
          <button
            onClick={() => setDate(undefined)}
            className="text-sm text-muted-foreground hover:underline"
          >
            Clear
          </button>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Calendar with footer actions for quick selection.',
      },
    },
  },
};
