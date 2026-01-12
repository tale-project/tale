import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { fn } from '@storybook/test';
import { AlertCircle } from 'lucide-react';
import { Dialog } from '../dialog/dialog';
import { ConfirmDialog } from '../dialog/confirm-dialog';
import { Button } from '../primitives/button';
import { Input } from '../forms/input';

const meta: Meta<typeof Dialog> = {
  title: 'Overlays/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A dialog component for modal content.

## Usage
\`\`\`tsx
import { Dialog } from '@/components/ui/overlays';

<Dialog
  open={open}
  onOpenChange={setOpen}
  title="Dialog Title"
  description="Dialog description"
>
  Content goes here
</Dialog>
\`\`\`

## Accessibility
- Built on Radix UI Dialog for full ARIA support
- Traps focus within the dialog
- Closes on Escape key
- Announces title and description to screen readers
        `,
      },
    },
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'default', 'md', 'lg', 'xl', 'wide', 'full'],
      description: 'Dialog size variant',
    },
    hideClose: {
      control: 'boolean',
      description: 'Hide the close button',
    },
  },
  args: {
    onOpenChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Edit Profile"
          description="Make changes to your profile here."
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setOpen(false)}>Save</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label="Name" defaultValue="John Doe" />
            <Input label="Email" type="email" defaultValue="john@example.com" />
          </div>
        </Dialog>
      </>
    );
  },
};

export const Sizes: Story = {
  render: function Render() {
    const [size, setSize] = useState<'sm' | 'default' | 'md' | 'lg' | 'xl'>(
      'default'
    );
    const [open, setOpen] = useState(false);
    return (
      <div className="flex gap-2">
        {(['sm', 'default', 'md', 'lg', 'xl'] as const).map((s) => (
          <Button
            key={s}
            variant="outline"
            onClick={() => {
              setSize(s);
              setOpen(true);
            }}
          >
            {s}
          </Button>
        ))}
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={`Size: ${size}`}
          description="This dialog demonstrates different size variants."
          size={size}
          footer={<Button onClick={() => setOpen(false)}>Close</Button>}
        >
          <p className="text-sm text-muted-foreground">
            Dialog content with {size} size.
          </p>
        </Dialog>
      </div>
    );
  },
};

export const WithIcon: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Warning"
          description="This action cannot be undone."
          icon={
            <div className="size-10 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertCircle className="size-5 text-amber-600" />
            </div>
          }
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => setOpen(false)}>
                Continue
              </Button>
            </>
          }
        />
      </>
    );
  },
};

export const WithTrigger: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Dialog with Trigger"
        description="This dialog has a built-in trigger."
        trigger={<Button>Open via Trigger</Button>}
        footer={<Button onClick={() => setOpen(false)}>Close</Button>}
      >
        <p className="text-sm">Content here.</p>
      </Dialog>
    );
  },
};

const ConfirmDialogMeta: Meta<typeof ConfirmDialog> = {
  title: 'Overlays/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
};

export const Confirm: StoryObj<typeof ConfirmDialog> = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Delete Item</Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete Item"
          description="Are you sure you want to delete this item? This action cannot be undone."
          confirmText="Delete"
          onConfirm={() => setOpen(false)}
          variant="destructive"
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'ConfirmDialog is a specialized dialog for confirmation actions.',
      },
    },
  },
};

export const ConfirmLoading: StoryObj<typeof ConfirmDialog> = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleConfirm = () => {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        setOpen(false);
      }, 2000);
    };

    return (
      <>
        <Button onClick={() => setOpen(true)}>Delete Item</Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete Item"
          description="This will permanently delete the item."
          confirmText="Delete"
          loadingText="Deleting..."
          isLoading={loading}
          onConfirm={handleConfirm}
          variant="destructive"
        />
      </>
    );
  },
};
