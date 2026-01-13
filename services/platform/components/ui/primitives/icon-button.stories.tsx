import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import {
  Trash2,
  Edit,
  MoreHorizontal,
  Settings,
  X,
  Plus,
  Copy,
  Download,
} from 'lucide-react';
import { IconButton } from './icon-button';

const meta: Meta<typeof IconButton> = {
  title: 'Primitives/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
An icon-only button component for compact UI actions.

## Usage
\`\`\`tsx
import { IconButton } from '@/components/ui/primitives';

<IconButton icon={Edit} aria-label="Edit item" />
<IconButton icon={Trash2} variant="destructive" aria-label="Delete item" />
\`\`\`

## Accessibility
- Requires \`aria-label\` prop (enforced by TypeScript)
- Icon is hidden from screen readers with \`aria-hidden\`
- Inherits Button's press animation and focus states
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'destructive',
        'success',
        'outline',
        'secondary',
        'ghost',
        'link',
        'primary',
      ],
      description: 'Visual style variant',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'ghost' },
      },
    },
    iconSize: {
      control: 'select',
      options: [3, 4, 5, 6],
      description: 'Icon size (Tailwind size classes)',
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '4' },
      },
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the button',
    },
  },
  args: {
    onClick: fn(),
    icon: Edit,
    'aria-label': 'Edit',
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {
  args: {
    icon: Edit,
    'aria-label': 'Edit item',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <IconButton icon={Settings} aria-label="Settings" variant="default" />
      <IconButton icon={Plus} aria-label="Add" variant="primary" />
      <IconButton icon={Copy} aria-label="Copy" variant="secondary" />
      <IconButton icon={Download} aria-label="Download" variant="outline" />
      <IconButton icon={MoreHorizontal} aria-label="More" variant="ghost" />
      <IconButton icon={Trash2} aria-label="Delete" variant="destructive" />
      <IconButton icon={Edit} aria-label="Edit" variant="success" />
    </div>
  ),
  parameters: {
    docs: {
      description: { story: 'All available icon button variants.' },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <IconButton icon={Edit} aria-label="Size 3" iconSize={3} />
      <IconButton icon={Edit} aria-label="Size 4" iconSize={4} />
      <IconButton icon={Edit} aria-label="Size 5" iconSize={5} />
      <IconButton icon={Edit} aria-label="Size 6" iconSize={6} />
    </div>
  ),
};

export const CommonActions: Story = {
  render: () => (
    <div className="flex items-center gap-2 p-4 border rounded-lg">
      <IconButton icon={Edit} aria-label="Edit" />
      <IconButton icon={Copy} aria-label="Copy" />
      <IconButton icon={Download} aria-label="Download" />
      <IconButton
        icon={Trash2}
        aria-label="Delete"
        variant="ghost"
        iconClassName="text-destructive"
      />
      <IconButton icon={MoreHorizontal} aria-label="More options" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Common action buttons pattern used in row actions or toolbars.',
      },
    },
  },
};

export const CloseButton: Story = {
  render: () => (
    <div className="relative p-8 border rounded-lg">
      <IconButton
        icon={X}
        aria-label="Close"
        className="absolute top-2 right-2"
      />
      <p className="text-sm text-muted-foreground">Modal or panel content</p>
    </div>
  ),
  parameters: {
    docs: {
      description: { story: 'Close button pattern for dialogs and panels.' },
    },
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="flex gap-4">
      <IconButton icon={Edit} aria-label="Edit" disabled />
      <IconButton icon={Trash2} aria-label="Delete" variant="destructive" disabled />
    </div>
  ),
};

export const PressAnimation: Story = {
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted-foreground">
        Click and hold to see the press animation
      </p>
      <IconButton icon={Plus} aria-label="Add" variant="primary" iconSize={5} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Icon buttons inherit the press animation from Button for consistent feedback.',
      },
    },
  },
};
