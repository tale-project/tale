import type { Meta, StoryObj } from '@storybook/react';
import {
  Mail,
  Trash2,
  Check,
  ArrowRight,
  Plus,
  Pencil,
  Copy,
} from 'lucide-react';
import { fn } from 'storybook/test';

import { Button, LinkButton } from './button';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A versatile button component with multiple variants and sizes.

## Usage
\`\`\`tsx
import { Button } from '@/app/components/ui/primitives';

<Button variant="primary">Click me</Button>
<Button variant="destructive" isLoading>Deleting...</Button>
\`\`\`

## Accessibility
- Uses native \`<button>\` element
- Supports \`disabled\` and \`aria-busy\` states
- Focus ring meets WCAG 2.1 contrast requirements
- Press feedback (scale) provides visual confirmation
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'primary',
        'secondary',
        'destructive',
        'success',
        'ghost',
        'link',
      ],
      description: 'Visual style variant',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'primary' },
      },
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
      description: 'Size variant',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'default' },
      },
    },
    isLoading: {
      control: 'boolean',
      description: 'Shows loading spinner and disables interaction',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the button',
    },
    collapseLabel: {
      control: 'boolean',
      description:
        'Collapse the label to an icon below the sm breakpoint (label stays in the a11y tree)',
    },
  },
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Button' },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="success">Success</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
  parameters: {
    docs: {
      description: { story: 'All available button variants.' },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" title="Add">
        <Plus className="size-4" />
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button icon={Mail}>Send email</Button>
      <Button icon={Trash2} variant="destructive">
        Delete
      </Button>
      <Button icon={Check} variant="success">
        Confirm
      </Button>
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button isLoading>Loading</Button>
      <Button isLoading variant="destructive">
        Deleting
      </Button>
      <Button isLoading variant="primary">
        Saving
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button disabled>Disabled</Button>
      <Button disabled variant="primary">
        Disabled primary
      </Button>
    </div>
  ),
};

export const AsLink: Story = {
  render: () => (
    <LinkButton href="/dashboard" icon={ArrowRight}>
      Go to dashboard
    </LinkButton>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Use `LinkButton` for navigation that looks like a button.',
      },
    },
  },
};

export const CollapseLabel: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button icon={Check} variant="secondary" collapseLabel>
        Save
      </Button>
      <Button icon={Trash2} variant="destructive" collapseLabel>
        Delete
      </Button>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'With `collapseLabel`, the text hides below the `sm` breakpoint (icon-only) and reappears from `sm` up — useful in crowded toolbars. The label stays in the accessibility tree, so the button keeps its name on mobile. Resize the preview to see it switch.',
      },
    },
  },
};

export const IconWithTooltip: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="icon" variant="ghost" title="Edit">
        <Pencil className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" title="Copy" tooltipSide="bottom">
        <Copy className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title="Delete"
        tooltip="Delete permanently"
        tooltipSide="right"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'A plain-string `title` names an icon-only button (it has no visible text) AND shows it as a hover/focus tooltip — one prop for both. Pass `tooltip` for richer tip content that differs from the accessible name, and `tooltipSide` to change where it opens. Focus or hover an icon to see the tip.',
      },
    },
  },
};

export const PressAnimation: Story = {
  args: { variant: 'primary', size: 'lg', children: 'Press me' },
  render: (args) => (
    <div className="flex flex-col items-center gap-4">
      <p className="text-muted-foreground text-sm">
        Click and hold to see the press animation
      </p>
      <Button {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Buttons have a subtle scale animation when pressed for tactile feedback.',
      },
    },
  },
};
