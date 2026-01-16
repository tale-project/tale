import type { Meta, StoryObj } from '@storybook/react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from './alert';

const meta: Meta<typeof Alert> = {
  title: 'Feedback/Alert',
  component: Alert,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
An alert component for displaying important messages.

## Usage
\`\`\`tsx
import { Alert, AlertTitle, AlertDescription } from '@/app/components/ui/feedback';

<Alert variant="destructive">
  <AlertCircle className="size-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>
\`\`\`

## Accessibility
- Uses \`role="alert"\` for screen reader announcement
- Supports \`aria-live\` for dynamic updates
- Icons should have \`aria-hidden="true"\`
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
    <Alert>
      <Info className="size-4" aria-hidden="true" />
      <AlertTitle>Information</AlertTitle>
      <AlertDescription>
        This is a default alert with helpful information.
      </AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive">
      <AlertCircle className="size-4" aria-hidden="true" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        Your session has expired. Please log in again.
      </AlertDescription>
    </Alert>
  ),
};

export const Warning: Story = {
  render: () => (
    <Alert variant="warning">
      <AlertTriangle className="size-4" aria-hidden="true" />
      <AlertTitle>Warning</AlertTitle>
      <AlertDescription>
        Your account will be deleted in 7 days.
      </AlertDescription>
    </Alert>
  ),
};

export const Success: Story = {
  render: () => (
    <Alert className="border-green-500/50 text-green-600 [&>svg]:text-green-600">
      <CheckCircle2 className="size-4" aria-hidden="true" />
      <AlertTitle>Success</AlertTitle>
      <AlertDescription>
        Your changes have been saved successfully.
      </AlertDescription>
    </Alert>
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
  render: () => (
    <Alert>
      <Info className="size-4" aria-hidden="true" />
      <AlertTitle>Heads up!</AlertTitle>
    </Alert>
  ),
};

export const DescriptionOnly: Story = {
  render: () => (
    <Alert>
      <Info className="size-4" aria-hidden="true" />
      <AlertDescription>
        You can add components to your app using the CLI.
      </AlertDescription>
    </Alert>
  ),
};

export const Assertive: Story = {
  render: () => (
    <Alert variant="destructive" live="assertive">
      <AlertCircle className="size-4" aria-hidden="true" />
      <AlertTitle>Critical Error</AlertTitle>
      <AlertDescription>
        This alert will be announced immediately by screen readers.
      </AlertDescription>
    </Alert>
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
