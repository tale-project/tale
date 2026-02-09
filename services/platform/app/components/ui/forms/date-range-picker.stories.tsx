import type { Meta, StoryObj } from '@storybook/react';
import type { DateRange } from 'react-day-picker';

import { fn } from '@storybook/test';
import { useState } from 'react';

import { DatePickerWithRange } from './date-range-picker';

const meta: Meta<typeof DatePickerWithRange> = {
  title: 'Forms/DateRangePicker',
  component: DatePickerWithRange,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A date range picker with preset options and custom range selection.

## Usage
\`\`\`tsx
import { DatePickerWithRange } from '@/app/components/ui/forms/date-range-picker';

<DatePickerWithRange
  onChange={(range) => console.log(range)}
  defaultDate={{ from: new Date(), to: new Date() }}
/>
\`\`\`

## Features
- Calendar popup for custom range selection
- Preset options (Today, Last 14 days, Month to date, etc.)
- Loading state support
- Automatic preset detection from selected range
        `,
      },
    },
  },
  argTypes: {
    isLoading: {
      control: 'boolean',
      description: 'Shows loading state',
    },
  },
  args: {
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof DatePickerWithRange>;

export const Default: Story = {
  args: {
    onChange: fn(),
  },
};

export const WithDefaultDate: Story = {
  args: {
    defaultDate: {
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      to: new Date(),
    },
    onChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Pre-selected date range (last 7 days).',
      },
    },
  },
};

export const Loading: Story = {
  args: {
    isLoading: true,
    onChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Loading state with disabled interaction.',
      },
    },
  },
};

export const Interactive: Story = {
  render: function InteractiveStory() {
    const [range, setRange] = useState<DateRange | undefined>(undefined);

    return (
      <div className="space-y-4">
        <DatePickerWithRange onChange={setRange} />
        {range && (
          <div className="text-muted-foreground text-sm">
            <p>From: {range.from?.toLocaleDateString()}</p>
            <p>To: {range.to?.toLocaleDateString()}</p>
          </div>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive example showing selected range.',
      },
    },
  },
};

export const PresetToday: Story = {
  args: {
    defaultDate: {
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(0, 0, 0, 0)),
    },
    onChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Today preset auto-detected.',
      },
    },
  },
};

export const PresetLast30Days: Story = {
  args: {
    defaultDate: {
      from: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
      to: new Date(new Date().setHours(0, 0, 0, 0)),
    },
    onChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Last 30 days preset.',
      },
    },
  },
};
