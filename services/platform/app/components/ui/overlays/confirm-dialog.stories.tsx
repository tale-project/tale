import type { Meta, StoryObj } from '@storybook/react';

import { Trash2, AlertTriangle, Archive, Send } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '../dialog/confirm-dialog';
import { Button } from '../primitives/button';

const meta: Meta<typeof ConfirmDialog> = {
  title: 'Overlays/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A confirmation dialog for actions requiring user confirmation.

## Usage
\`\`\`tsx
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';

<ConfirmDialog
  open={open}
  onOpenChange={setOpen}
  title="Delete item?"
  description="This action cannot be undone."
  variant="destructive"
  onConfirm={handleDelete}
/>
\`\`\`

## Accessibility
- Focus trapped within dialog
- Escape key closes dialog
- Cancel and confirm buttons clearly labeled
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmDialog>;

export const Default: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Confirm action"
          description="Are you sure you want to proceed with this action?"
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  },
};

export const Destructive: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 className="mr-2 size-4" />
          Delete
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete item?"
          description="This action cannot be undone. This will permanently delete the item and all associated data."
          variant="destructive"
          confirmText="Delete"
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  },
};

export const WithContent: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete Project
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete project?"
          description="This will permanently delete the project and all its contents."
          variant="destructive"
          confirmText="Delete Project"
          onConfirm={() => setOpen(false)}
        >
          <div className="bg-muted rounded-lg p-3">
            <p className="text-sm font-medium">Project: My Awesome Project</p>
            <p className="text-muted-foreground text-sm">23 files · 1.2 GB</p>
          </div>
        </ConfirmDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Dialog can include a preview of the item being affected.',
      },
    },
  },
};

export const Loading: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleConfirm = () => {
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
        setOpen(false);
      }, 2000);
    };

    return (
      <>
        <Button onClick={() => setOpen(true)}>Submit</Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Submit form?"
          description="This will submit the form for review."
          confirmText="Submit"
          loadingText="Submitting..."
          isLoading={isLoading}
          onConfirm={handleConfirm}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Dialog shows loading state during async operations.',
      },
    },
  },
};

export const ArchiveItem: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Archive className="mr-2 size-4" />
          Archive
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Archive item?"
          description="This item will be moved to the archive. You can restore it later."
          confirmText="Archive"
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  },
};

export const SendNotification: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>
          <Send className="mr-2 size-4" />
          Send to all users
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Send notification?"
          description="This will send a notification to all 1,234 users in your organization."
          confirmText="Send notification"
          onConfirm={() => setOpen(false)}
        >
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-700">
              This action will notify all users immediately.
            </p>
          </div>
        </ConfirmDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Include warning content for high-impact actions.',
      },
    },
  },
};

export const CustomButtonText: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Leave page</Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Unsaved changes"
          description="You have unsaved changes. Are you sure you want to leave this page?"
          cancelText="Stay on page"
          confirmText="Leave without saving"
          variant="destructive"
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Customize button text for specific use cases.',
      },
    },
  },
};
