import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';

import { Button } from '../primitives/button';
import { DeleteDialog } from './delete-dialog';

const meta: Meta<typeof DeleteDialog> = {
  title: 'Dialog/DeleteDialog',
  component: DeleteDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A specialized confirmation dialog for delete operations.

## Usage
\`\`\`tsx
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';

<DeleteDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  title="Delete Customer"
  description="Are you sure you want to delete this customer?"
  preview={{ primary: 'Acme Corp', secondary: 'customer@acme.com' }}
  onDelete={handleDelete}
  isDeleting={isDeleting}
/>
\`\`\`

## Features
- Destructive styling by default
- Item preview display
- Warning message support
- Loading state during deletion
- Built on ConfirmDialog
        `,
      },
    },
  },
  argTypes: {
    isDeleting: {
      control: 'boolean',
      description: 'Whether deletion is in progress',
    },
  },
};

export default meta;
type Story = StoryObj<typeof DeleteDialog>;

export const Default: Story = {
  render: function DefaultStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete Item
        </Button>
        <DeleteDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete Item"
          description="Are you sure you want to delete this item? This action cannot be undone."
          onDelete={() => {
            alert('Item deleted!');
            setOpen(false);
          }}
        />
      </>
    );
  },
};

export const WithPreview: Story = {
  render: function PreviewStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete Customer
        </Button>
        <DeleteDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete Customer"
          description="Are you sure you want to delete this customer?"
          preview={{
            primary: 'Acme Corporation',
            secondary: 'contact@acme.com',
          }}
          onDelete={() => {
            alert('Customer deleted!');
            setOpen(false);
          }}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Show a preview of the item being deleted.',
      },
    },
  },
};

export const WithWarning: Story = {
  render: function WarningStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete Project
        </Button>
        <DeleteDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete Project"
          description="Are you sure you want to delete this project?"
          preview={{
            primary: 'Marketing Campaign Q1',
          }}
          warning="All tasks, files, and comments associated with this project will also be permanently deleted."
          onDelete={() => {
            alert('Project deleted!');
            setOpen(false);
          }}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Warning message for additional context about consequences.',
      },
    },
  },
};

export const Deleting: Story = {
  render: function DeletingStory() {
    const [open, setOpen] = useState(true);

    return (
      <DeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete Item"
        description="Are you sure?"
        isDeleting={true}
        onDelete={() => {}}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Loading state during deletion.',
      },
    },
  },
};

export const CustomButtonText: Story = {
  render: function CustomTextStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Remove User
        </Button>
        <DeleteDialog
          open={open}
          onOpenChange={setOpen}
          title="Remove Team Member"
          description="This will remove the user from your team."
          preview={{
            primary: 'Jane Smith',
            secondary: 'jane@company.com',
          }}
          cancelText="Keep Member"
          deleteText="Remove Member"
          deletingText="Removing..."
          onDelete={() => {
            setOpen(false);
          }}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom text for cancel and delete buttons.',
      },
    },
  },
};

export const WithChildren: Story = {
  render: function ChildrenStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete Account
        </Button>
        <DeleteDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete Account"
          description="This will permanently delete your account."
          warning="This action cannot be undone."
          onDelete={() => {
            setOpen(false);
          }}
        >
          <div className="space-y-2 text-sm">
            <p className="font-medium">The following will be deleted:</p>
            <ul className="text-muted-foreground list-inside list-disc space-y-1">
              <li>All your projects and data</li>
              <li>Team memberships</li>
              <li>API keys and integrations</li>
              <li>Payment history</li>
            </ul>
          </div>
        </DeleteDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Additional content for complex delete confirmations.',
      },
    },
  },
};
