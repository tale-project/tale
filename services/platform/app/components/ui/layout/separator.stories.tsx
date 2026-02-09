import type { Meta, StoryObj } from '@storybook/react';

import { Separator } from './separator';

const meta: Meta<typeof Separator> = {
  title: 'Layout/Separator',
  component: Separator,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A separator component for visually dividing content.

## Usage
\`\`\`tsx
import { Separator } from '@/app/components/ui/layout/layout';

<Separator />
<Separator orientation="vertical" className="h-4" />
\`\`\`

## Accessibility
- Built on Radix UI Separator
- Uses \`decorative\` prop for ARIA (true by default)
- Non-decorative separators are announced by screen readers
        `,
      },
    },
  },
  argTypes: {
    orientation: {
      control: 'select',
      options: ['horizontal', 'vertical'],
      description: 'Separator orientation',
    },
    decorative: {
      control: 'boolean',
      description: 'Whether the separator is decorative (ARIA)',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Separator>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-64">
      <p className="mb-4 text-sm">Content above</p>
      <Separator />
      <p className="mt-4 text-sm">Content below</p>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-4">
      <span className="text-sm">Item 1</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Item 2</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Item 3</span>
    </div>
  ),
};

export const InList: Story = {
  render: () => (
    <div className="w-64">
      <div className="py-2">
        <h4 className="text-sm font-medium">Settings</h4>
        <p className="text-muted-foreground text-xs">Manage your preferences</p>
      </div>
      <Separator />
      <div className="py-2">
        <h4 className="text-sm font-medium">Profile</h4>
        <p className="text-muted-foreground text-xs">Edit your profile</p>
      </div>
      <Separator />
      <div className="py-2">
        <h4 className="text-sm font-medium">Logout</h4>
        <p className="text-muted-foreground text-xs">
          Sign out of your account
        </p>
      </div>
    </div>
  ),
};

export const InToolbar: Story = {
  render: () => (
    <div className="flex items-center gap-2 rounded-lg border p-2">
      <button className="hover:bg-muted rounded p-2">Bold</button>
      <button className="hover:bg-muted rounded p-2">Italic</button>
      <Separator orientation="vertical" className="h-6" />
      <button className="hover:bg-muted rounded p-2">Left</button>
      <button className="hover:bg-muted rounded p-2">Center</button>
      <button className="hover:bg-muted rounded p-2">Right</button>
      <Separator orientation="vertical" className="h-6" />
      <button className="hover:bg-muted rounded p-2">Link</button>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Vertical separators in a toolbar to group related actions.',
      },
    },
  },
};

export const NonDecorative: Story = {
  args: {
    decorative: false,
  },
  render: (args) => (
    <div className="w-64">
      <p className="mb-4 text-sm">Section 1</p>
      <Separator {...args} />
      <p className="mt-4 text-sm">Section 2</p>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Non-decorative separators are announced by screen readers as semantic content dividers.',
      },
    },
  },
};
