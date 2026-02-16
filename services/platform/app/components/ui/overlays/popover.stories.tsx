import type { Meta, StoryObj } from '@storybook/react';

import { Input } from '../forms/input';
import { Button } from '../primitives/button';
import { Popover } from './popover';

const meta: Meta<typeof Popover> = {
  title: 'Overlays/Popover',
  component: Popover,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A popover component for displaying content in a floating panel.

## Usage
\`\`\`tsx
import { Popover } from '@/app/components/ui/overlays/popover';

<Popover trigger={<Button>Open</Button>} contentClassName="w-80">
  Content goes here
</Popover>
\`\`\`

## Accessibility
- Focus trapped within popover when open
- Escape closes the popover
- Click outside closes the popover
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  render: () => (
    <Popover
      trigger={<Button variant="outline">Open Popover</Button>}
      contentClassName="w-80"
    >
      <div className="grid gap-4">
        <div className="space-y-2">
          <h4 className="leading-none font-medium">Dimensions</h4>
          <p className="text-muted-foreground text-sm">
            Set the dimensions for the layer.
          </p>
        </div>
        <div className="grid gap-2">
          <Input label="Width" defaultValue="100%" className="h-8" />
          <Input label="Height" defaultValue="25px" className="h-8" />
        </div>
      </div>
    </Popover>
  ),
};

export const AlignStart: Story = {
  render: () => (
    <Popover
      trigger={<Button variant="outline">Align Start</Button>}
      align="start"
    >
      <p className="text-sm">This popover is aligned to the start.</p>
    </Popover>
  ),
};

export const AlignEnd: Story = {
  render: () => (
    <Popover trigger={<Button variant="outline">Align End</Button>} align="end">
      <p className="text-sm">This popover is aligned to the end.</p>
    </Popover>
  ),
};

export const WithForm: Story = {
  render: () => (
    <Popover trigger={<Button>Update Email</Button>} contentClassName="w-80">
      <form className="grid gap-4">
        <div className="space-y-1">
          <h4 className="text-sm leading-none font-medium">Update email</h4>
          <p className="text-muted-foreground text-sm">
            Enter your new email address below.
          </p>
        </div>
        <Input
          id="email"
          label="Email"
          type="email"
          placeholder="name@example.com"
        />
        <Button type="submit" size="sm">
          Save changes
        </Button>
      </form>
    </Popover>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Popovers can contain forms for quick data entry.',
      },
    },
  },
};

export const SimpleContent: Story = {
  render: () => (
    <Popover
      trigger={
        <Button variant="ghost" size="sm">
          Info
        </Button>
      }
      contentClassName="w-64"
    >
      <p className="text-muted-foreground text-sm">
        This is a simple informational popover with some helpful text.
      </p>
    </Popover>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Simple popovers for displaying additional information.',
      },
    },
  },
};
