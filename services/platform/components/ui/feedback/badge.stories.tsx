import type { Meta, StoryObj } from '@storybook/react';
import { Check, Clock, AlertCircle, Star } from 'lucide-react';
import { Badge } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'Feedback/Badge',
  component: Badge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A badge component for displaying status or labels.

## Usage
\`\`\`tsx
import { Badge } from '@/components/ui/feedback';

<Badge variant="green">Active</Badge>
<Badge variant="destructive" dot>Error</Badge>
<Badge icon={Check} variant="blue">Verified</Badge>
\`\`\`

## Accessibility
- Icons and dots are hidden from screen readers
- Text content is readable by screen readers
- Has title attribute for truncated content
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['outline', 'destructive', 'orange', 'yellow', 'blue', 'green'],
      description: 'Visual style variant',
    },
    dot: {
      control: 'boolean',
      description: 'Show status dot',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    children: 'Badge',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="orange">Orange</Badge>
      <Badge variant="yellow">Yellow</Badge>
      <Badge variant="blue">Blue</Badge>
      <Badge variant="green">Green</Badge>
    </div>
  ),
};

export const WithDot: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline" dot>
        Inactive
      </Badge>
      <Badge variant="destructive" dot>
        Error
      </Badge>
      <Badge variant="orange" dot>
        Pending
      </Badge>
      <Badge variant="yellow" dot>
        Warning
      </Badge>
      <Badge variant="blue" dot>
        Info
      </Badge>
      <Badge variant="green" dot>
        Active
      </Badge>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Badges with status dots for quick visual identification.',
      },
    },
  },
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="green" icon={Check}>
        Verified
      </Badge>
      <Badge variant="orange" icon={Clock}>
        Pending
      </Badge>
      <Badge variant="destructive" icon={AlertCircle}>
        Error
      </Badge>
      <Badge variant="yellow" icon={Star}>
        Featured
      </Badge>
    </div>
  ),
};

export const StatusExamples: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm w-24">Status:</span>
        <Badge variant="green" dot>
          Active
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm w-24">Priority:</span>
        <Badge variant="destructive">High</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm w-24">Type:</span>
        <Badge variant="blue" icon={Star}>
          Premium
        </Badge>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Common badge usage patterns.',
      },
    },
  },
};

export const Truncated: Story = {
  render: () => (
    <div className="w-32">
      <Badge variant="blue">
        This is a very long badge text that will be truncated
      </Badge>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Long text is automatically truncated with ellipsis. Hover to see full text via title attribute.',
      },
    },
  },
};
