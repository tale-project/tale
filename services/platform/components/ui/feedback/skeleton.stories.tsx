import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from './skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A loading placeholder component with pulse animation.

## Usage
\`\`\`tsx
import { Skeleton } from '@/components/ui/feedback/skeleton';

// Fixed size
<Skeleton size="md" />

// Custom size with className
<Skeleton className="h-4 w-32" />

// Circle shape for avatars
<Skeleton size="lg" shape="circle" />
\`\`\`

## Accessibility
- Uses \`role="status"\` for screen reader announcement
- Includes \`aria-label\` describing loading state
- Visually hidden text for screen readers
        `,
      },
    },
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
      description: 'Predefined size variants',
    },
    shape: {
      control: 'select',
      options: ['default', 'circle'],
      description: 'Shape of the skeleton',
    },
    label: {
      control: 'text',
      description: 'Accessible label for screen readers',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {
  args: {
    className: 'h-4 w-32',
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Skeleton size="xs" />
      <Skeleton size="sm" />
      <Skeleton size="md" />
      <Skeleton size="lg" />
      <Skeleton size="xl" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available size variants: xs, sm, md, lg, xl.',
      },
    },
  },
};

export const CircleShape: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Skeleton size="xs" shape="circle" />
      <Skeleton size="sm" shape="circle" />
      <Skeleton size="md" shape="circle" />
      <Skeleton size="lg" shape="circle" />
      <Skeleton size="xl" shape="circle" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Circle shape for avatar placeholders.',
      },
    },
  },
};

export const TextLines: Story = {
  render: () => (
    <div className="space-y-2 w-64">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Text content placeholder with varying line widths.',
      },
    },
  },
};

export const CardSkeleton: Story = {
  render: () => (
    <div className="w-72 p-4 border rounded-lg space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton size="lg" shape="circle" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example card loading state with avatar and text.',
      },
    },
  },
};

export const TableRowSkeleton: Story = {
  render: () => (
    <div className="w-full max-w-lg space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 p-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Table rows loading state.',
      },
    },
  },
};

export const CustomLabel: Story = {
  args: {
    size: 'lg',
    label: 'Loading user profile',
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom accessible label for screen readers.',
      },
    },
  },
};
