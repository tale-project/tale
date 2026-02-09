import type { Meta, StoryObj } from '@storybook/react';

import { Progress } from './progress';

const meta: Meta<typeof Progress> = {
  title: 'Feedback/Progress',
  component: Progress,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A progress bar component for showing completion status.

## Usage
\`\`\`tsx
import { Progress } from '@/app/components/ui/feedback';

<Progress value={50} />
<Progress value={75} max={100} label="Uploading file" />
\`\`\`

## Accessibility
- Uses \`role="progressbar"\` with proper ARIA attributes
- \`aria-valuenow\`, \`aria-valuemin\`, \`aria-valuemax\` for current state
- Optional \`label\` prop for screen reader context
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
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Progress>;

export const Default: Story = {
  args: {
    value: 50,
  },
};

export const Empty: Story = {
  args: {
    value: 0,
  },
};

export const Complete: Story = {
  args: {
    value: 100,
  },
};

export const WithLabel: Story = {
  args: {
    value: 66,
    label: 'Uploading file',
  },
  parameters: {
    docs: {
      description: {
        story: 'Progress with accessible label for screen readers.',
      },
    },
  },
};

export const ProgressStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="w-12 text-sm">0%</span>
        <Progress value={0} className="flex-1" />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 text-sm">25%</span>
        <Progress value={25} className="flex-1" />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 text-sm">50%</span>
        <Progress value={50} className="flex-1" />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 text-sm">75%</span>
        <Progress value={75} className="flex-1" />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 text-sm">100%</span>
        <Progress value={100} className="flex-1" />
      </div>
    </div>
  ),
};

export const CustomMax: Story = {
  args: {
    value: 3,
    max: 5,
    label: 'Step 3 of 5',
  },
  parameters: {
    docs: {
      description: {
        story: 'Progress with custom max value for step-based progress.',
      },
    },
  },
};

export const CustomColors: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Progress value={60} />
      <Progress value={60} indicatorClassName="bg-green-500" />
      <Progress value={60} indicatorClassName="bg-orange-500" />
      <Progress value={60} indicatorClassName="bg-red-500" />
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

export const UploadExample: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-sm">
        <span>Uploading document.pdf</span>
        <span>67%</span>
      </div>
      <Progress value={67} label="Uploading document.pdf" />
    </div>
  ),
};
