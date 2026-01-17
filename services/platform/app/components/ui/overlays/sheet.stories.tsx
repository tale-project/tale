import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from './sheet';
import { Button } from '../primitives/button';
import { Input } from '../forms/input';

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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/app/components/ui/overlays/sheet';

<Sheet>
  <SheetTrigger asChild>
    <Button>Open Sheet</Button>
  </SheetTrigger>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Sheet Title</SheetTitle>
    </SheetHeader>
    Content here
  </SheetContent>
</Sheet>
\`\`\`

## Accessibility
- Built on Radix UI Dialog for full ARIA support
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
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open Sheet</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit Profile</SheetTitle>
          <SheetDescription>
            Make changes to your profile here. Click save when you&apos;re done.
          </SheetDescription>
        </SheetHeader>
        <div className="py-4 space-y-4">
          <Input label="Name" defaultValue="John Doe" />
          <Input label="Email" type="email" defaultValue="john@example.com" />
        </div>
        <SheetFooter>
          <Button type="submit">Save changes</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const Sides: Story = {
  render: function Render() {
    const [side, setSide] = useState<'top' | 'right' | 'bottom' | 'left'>('right');
    const [open, setOpen] = useState(false);

    return (
      <div className="flex gap-2">
        {(['top', 'right', 'bottom', 'left'] as const).map((s) => (
          <Button
            key={s}
            variant="outline"
            onClick={() => {
              setSide(s);
              setOpen(true);
            }}
          >
            {s}
          </Button>
        ))}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>Sheet from {side}</SheetTitle>
              <SheetDescription>
                This sheet slides in from the {side}.
              </SheetDescription>
            </SheetHeader>
          </SheetContent>
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
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open Sheet</Button>
      </SheetTrigger>
      <SheetContent hideClose>
        <SheetHeader>
          <SheetTitle>Custom Close Handling</SheetTitle>
          <SheetDescription>
            This sheet has no default close button. Use your own close logic.
          </SheetDescription>
        </SheetHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Press Escape or click outside to close.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  ),
};

export const WithForm: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);

    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button>Add New Item</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add New Item</SheetTitle>
            <SheetDescription>
              Fill in the details below to create a new item.
            </SheetDescription>
          </SheetHeader>
          <form
            className="py-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setOpen(false);
            }}
          >
            <Input label="Title" required />
            <Input label="Description" />
            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    );
  },
};
