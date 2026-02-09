import type { Meta, StoryObj } from '@storybook/react';

import { fn } from '@storybook/test';
import { Mail, Trash2, Check, ArrowRight, Plus } from 'lucide-react';

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

<Button variant="default">Click me</Button>
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
        defaultValue: { summary: 'default' },
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
      <Button variant="default">Default</Button>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
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
      <Button size="icon">
        <Plus className="size-4" />
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button icon={Mail}>Send Email</Button>
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
        Disabled Primary
      </Button>
    </div>
  ),
};

export const AsLink: Story = {
  render: () => (
    <LinkButton href="/dashboard" icon={ArrowRight}>
      Go to Dashboard
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

export const PressAnimation: Story = {
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <p className="text-muted-foreground text-sm">
        Click and hold to see the press animation
      </p>
      <Button variant="primary" size="lg">
        Press Me
      </Button>
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
