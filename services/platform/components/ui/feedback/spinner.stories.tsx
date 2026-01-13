import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from './spinner';

const meta: Meta<typeof Spinner> = {
  title: 'Feedback/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A loading spinner component.

## Usage
\`\`\`tsx
import { Spinner } from '@/components/ui/feedback';

<Spinner />
<Spinner size="lg" label="Saving changes" />
\`\`\`

## Accessibility
- Uses \`role="status"\` for screen reader announcement
- Customizable \`label\` prop for context-specific loading messages
- Includes visually hidden text for screen readers
        `,
      },
    },
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Spinner size',
    },
    label: {
      control: 'text',
      description: 'Accessible label for screen readers',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = {
  args: {},
};

export const Small: Story = {
  args: {
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
    </div>
  ),
};

export const CustomLabel: Story = {
  args: {
    label: 'Saving changes',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Custom label for context-specific loading states. Screen readers will announce this text.',
      },
    },
  },
};

export const InButton: Story = {
  render: () => (
    <button
      disabled
      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg opacity-70"
    >
      <Spinner size="sm" label="Submitting" className="text-current" />
      Submitting...
    </button>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Spinner used inside a button during loading state.',
      },
    },
  },
};

export const CustomColor: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner className="text-primary" />
      <Spinner className="text-destructive" />
      <Spinner className="text-success" />
    </div>
  ),
};
