import type { Meta, StoryObj } from '@storybook/react';

import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';

import { Alert } from './alert';

const meta: Meta<typeof Alert> = {
  title: 'Feedback/Alert',
  component: Alert,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A single-piece alert component for displaying important messages.

## Usage
\`\`\`tsx
import { Alert } from '@/app/components/ui/feedback/alert';

<Alert
  variant="destructive"
  icon={AlertCircle}
  title="Error"
  description="Something went wrong."
/>
\`\`\`

## Accessibility
- Uses \`role="alert"\` for screen reader announcement
- Supports \`aria-live\` for dynamic updates
- Icons are automatically \`aria-hidden="true"\`
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'warning'],
      description: 'Visual style variant',
    },
    live: {
      control: 'select',
      options: ['polite', 'assertive', 'off'],
      description: 'ARIA live region behavior',
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Alert>;

export const Default: Story = {
  render: () => (
    <Alert
      icon={Info}
      title="Information"
      description="This is a default alert with helpful information."
    />
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert
      variant="destructive"
      icon={AlertCircle}
      title="Error"
      description="Your session has expired. Please log in again."
    />
  ),
};

export const Warning: Story = {
  render: () => (
    <Alert
      variant="warning"
      icon={AlertTriangle}
      title="Warning"
      description="Your account will be deleted in 7 days."
    />
  ),
};

export const Success: Story = {
  render: () => (
    <Alert
      icon={CheckCircle2}
      title="Success"
      description="Your changes have been saved successfully."
      className="border-green-500/50 text-green-600 [&>svg]:text-green-600"
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Custom success variant using className.',
      },
    },
  },
};

export const TitleOnly: Story = {
  render: () => <Alert icon={Info} title="Heads up!" />,
};

export const DescriptionOnly: Story = {
  render: () => (
    <Alert
      icon={Info}
      description="You can add components to your app using the CLI."
    />
  ),
};

export const Assertive: Story = {
  render: () => (
    <Alert
      variant="destructive"
      live="assertive"
      icon={AlertCircle}
      title="Critical Error"
      description="This alert will be announced immediately by screen readers."
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Use `live="assertive"` for critical messages that need immediate attention.',
      },
    },
  },
};
