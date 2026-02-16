import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';

import { Input } from '../forms/input';
import { Button } from '../primitives/button';
import { Sheet } from './sheet';

const meta: Meta<typeof Sheet> = {
  title: 'Overlays/Sheet',
  component: Sheet,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A sheet component that slides in from the edge of the screen.

## Usage
\`\`\`tsx
import { Sheet } from '@/app/components/ui/overlays/sheet';

<Sheet
  open={isOpen}
  onOpenChange={setIsOpen}
  title="Edit Profile"
  description="Make changes to your profile."
>
  Content here
</Sheet>
\`\`\`

## Accessibility
- Built on Radix UI Dialog for full ARIA support
- Title and description are rendered as screen-reader only text
- Focus is trapped within the sheet
- Closes on Escape key
- Close button has proper aria-label
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Sheet>;

export const Default: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open Sheet
        </Button>
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title="Edit Profile"
          description="Make changes to your profile here. Click save when you're done."
        >
          <div className="space-y-4 py-4">
            <Input label="Name" defaultValue="John Doe" />
            <Input label="Email" type="email" defaultValue="john@example.com" />
          </div>
          <div className="flex justify-end">
            <Button type="submit">Save changes</Button>
          </div>
        </Sheet>
      </>
    );
  },
};

export const Sides: Story = {
  render: function Render() {
    const [side, setSide] = useState<'top' | 'right' | 'bottom' | 'left'>(
      'right',
    );
    const [open, setOpen] = useState(false);

    return (
      <div className="flex gap-2">
        {(['top', 'right', 'bottom', 'left'] as const).map((s) => (
          <Button
            key={s}
            variant="secondary"
            onClick={() => {
              setSide(s);
              setOpen(true);
            }}
          >
            {s}
          </Button>
        ))}
        <Sheet
          open={open}
          onOpenChange={setOpen}
          side={side}
          title={`Sheet from ${side}`}
          description={`This sheet slides in from the ${side}.`}
        >
          <p className="text-muted-foreground text-sm">
            Content slides in from the {side}.
          </p>
        </Sheet>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Sheets can slide in from any side of the screen.',
      },
    },
  },
};

export const HideClose: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open Sheet
        </Button>
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title="Custom Close Handling"
          description="This sheet has no default close button. Use your own close logic."
          hideClose
        >
          <p className="text-muted-foreground text-sm">
            Press Escape or click outside to close.
          </p>
        </Sheet>
      </>
    );
  },
};

export const WithForm: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Add New Item</Button>
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title="Add New Item"
          description="Fill in the details below to create a new item."
        >
          <form
            className="space-y-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              setOpen(false);
            }}
          >
            <Input label="Title" required />
            <Input label="Description" />
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </div>
          </form>
        </Sheet>
      </>
    );
  },
};
