import type { Meta, StoryObj } from '@storybook/react';

import { ProgressBar } from './progress-bar';

const meta: Meta<typeof ProgressBar> = {
  title: 'Feedback/ProgressBar',
  component: ProgressBar,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A progress bar with percentage label and hover tooltip.

## Usage
\`\`\`tsx
import { ProgressBar } from '@/app/components/ui/feedback/progress-bar';

<ProgressBar
  value={25}
  max={100}
  label="Indexed pages"
  tooltipContent="25 of 100 pages indexed"
/>
\`\`\`

## Accessibility
- Uses \`role="progressbar"\` with proper ARIA attributes
- Group wrapper with \`aria-label\` for screen readers
- Tooltip provides additional context on hover/focus
        `,
      },
    },
  },
  argTypes: {
    value: {
      control: { type: 'range', min: 0, max: 100 },
      description: 'Current progress value',
    },
    max: {
      control: 'number',
      description: 'Maximum value',
    },
    label: {
      control: 'text',
      description: 'Accessible label for screen readers',
    },
  },
  decorators: [
    (Story) => (
      <div className="w-48">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const Default: Story = {
  args: {
    value: 50,
    max: 100,
    label: 'Indexed pages',
    tooltipContent: '50\u202F% - 50 of 100 pages',
  },
};

export const Empty: Story = {
  args: {
    value: 0,
    max: 100,
    label: 'Indexed pages',
    tooltipContent: '0\u202F% - 0 of 100 pages',
  },
};

export const Complete: Story = {
  args: {
    value: 100,
    max: 100,
    label: 'Indexed pages',
    tooltipContent: '100\u202F% - 100 of 100 pages',
  },
};

export const Partial: Story = {
  args: {
    value: 37,
    max: 150,
    label: 'Indexed pages',
    tooltipContent: '25\u202F% - 37 of 150 pages',
  },
};

export const CustomMax: Story = {
  args: {
    value: 3,
    max: 5,
    label: 'Step 3 of 5',
    tooltipContent: 'Step 3 of 5',
  },
  parameters: {
    docs: {
      description: {
        story: 'Progress with custom max value for step-based progress.',
      },
    },
  },
};

export const States: Story = {
  render: () => (
    <div className="flex w-48 flex-col gap-4">
      <ProgressBar
        value={0}
        max={100}
        label="Not started"
        tooltipContent={'0\u202F% - 0 of 100 pages'}
      />
      <ProgressBar
        value={25}
        max={100}
        label="Quarter done"
        tooltipContent={'25\u202F% - 25 of 100 pages'}
      />
      <ProgressBar
        value={50}
        max={100}
        label="Half done"
        tooltipContent={'50\u202F% - 50 of 100 pages'}
      />
      <ProgressBar
        value={75}
        max={100}
        label="Almost done"
        tooltipContent={'75\u202F% - 75 of 100 pages'}
      />
      <ProgressBar
        value={100}
        max={100}
        label="Complete"
        tooltipContent={'100\u202F% - 100 of 100 pages'}
      />
    </div>
  ),
};

export const CustomColors: Story = {
  render: () => (
    <div className="flex w-48 flex-col gap-4">
      <ProgressBar
        value={60}
        max={100}
        label="Default"
        tooltipContent={'60\u202F%'}
      />
      <ProgressBar
        value={60}
        max={100}
        label="Orange"
        tooltipContent={'60\u202F%'}
        indicatorClassName="bg-orange-500"
      />
      <ProgressBar
        value={60}
        max={100}
        label="Red"
        tooltipContent={'60\u202F%'}
        indicatorClassName="bg-red-500"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Progress with custom indicator colors.',
      },
    },
  },
};
