import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';

import { Button } from '../primitives/button';
import { EntityDeleteDialog } from './entity-delete-dialog';

interface SampleEntity {
  _id: string;
  name: string;
  email?: string;
}

const sampleEntity: SampleEntity = {
  _id: 'entity_123',
  name: 'Acme Corporation',
  email: 'contact@acme.com',
};

const meta: Meta = {
  title: 'Dialog/DeleteDialog/EntityWrapper',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A generic, reusable delete confirmation dialog for any entity type. Wraps DeleteDialog with consistent toast feedback and entity name interpolation.

## Usage
\`\`\`tsx
import { EntityDeleteDialog } from '@/app/components/ui/entity/entity-delete-dialog';

<EntityDeleteDialog
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  entity={customer}
  getEntityName={(c) => c.name || 'this customer'}
  deleteMutation={async (c) => deleteCustomer({ customerId: c._id })}
  translations={{
    title: 'Delete customer',
    description: 'Are you sure you want to delete {name}?',
    successMessage: 'Customer deleted',
    errorMessage: 'Failed to delete customer',
  }}
/>
\`\`\`

## Features
- Generic type parameter for any entity shape
- \`{name}\` placeholder in description is replaced with bold entity name
- Optional warning text
- Success/error toast notifications
- Memoized for performance
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: function DefaultStory() {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setIsOpen(true)}>
          Delete customer
        </Button>
        <EntityDeleteDialog<SampleEntity>
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          entity={sampleEntity}
          getEntityName={(e) => e.name}
          deleteMutation={async () => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }}
          translations={{
            title: 'Delete customer',
            description:
              'Are you sure you want to delete {name}? This action cannot be undone.',
            successMessage: 'Customer deleted successfully',
            errorMessage: 'Failed to delete customer',
          }}
        />
      </>
    );
  },
};

export const WithWarning: Story = {
  render: function WarningStory() {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setIsOpen(true)}>
          Delete vendor
        </Button>
        <EntityDeleteDialog<SampleEntity>
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          entity={{ _id: 'vendor_456', name: 'Global Supplies Inc.' }}
          getEntityName={(e) => e.name}
          deleteMutation={async () => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }}
          translations={{
            title: 'Delete vendor',
            description: 'Are you sure you want to delete {name}?',
            warningText:
              'All associated purchase orders and invoices will be permanently removed.',
            successMessage: 'Vendor deleted successfully',
            errorMessage: 'Failed to delete vendor',
          }}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Delete dialog with an additional warning message about consequences.',
      },
    },
  },
};

export const WithErrorSimulation: Story = {
  render: function ErrorStory() {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setIsOpen(true)}>
          Delete product
        </Button>
        <EntityDeleteDialog<SampleEntity>
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          entity={{ _id: 'prod_789', name: 'Widget Pro' }}
          getEntityName={(e) => e.name}
          deleteMutation={async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            throw new Error('Cannot delete: product has active orders');
          }}
          translations={{
            title: 'Delete product',
            description: 'Are you sure you want to delete {name}?',
            successMessage: 'Product deleted',
            errorMessage: 'Failed to delete product',
          }}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Simulates a deletion failure — shows error toast when the mutation throws.',
      },
    },
  },
};

export const WithSuccessCallback: Story = {
  render: function SuccessCallbackStory() {
    const [isOpen, setIsOpen] = useState(false);
    const [deleted, setDeleted] = useState(false);

    return (
      <>
        {deleted ? (
          <p className="text-success text-sm font-medium">
            Entity deleted — onSuccess callback fired!
          </p>
        ) : (
          <Button variant="destructive" onClick={() => setIsOpen(true)}>
            Delete item
          </Button>
        )}
        <EntityDeleteDialog<SampleEntity>
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          entity={sampleEntity}
          getEntityName={(e) => e.name}
          deleteMutation={async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }}
          translations={{
            title: 'Delete item',
            description: 'Are you sure you want to delete {name}?',
            successMessage: 'Item deleted',
            errorMessage: 'Failed to delete item',
          }}
          onSuccess={() => setDeleted(true)}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Demonstrates the onSuccess callback — updates parent state after successful deletion.',
      },
    },
  },
};

export const WithoutNamePlaceholder: Story = {
  render: function NoPlaceholderStory() {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="destructive" onClick={() => setIsOpen(true)}>
          Delete selected items
        </Button>
        <EntityDeleteDialog<SampleEntity>
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          entity={sampleEntity}
          getEntityName={(e) => e.name}
          deleteMutation={async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }}
          translations={{
            title: 'Delete items',
            description:
              'Are you sure you want to delete the selected items? This action cannot be undone.',
            successMessage: 'Items deleted',
            errorMessage: 'Failed to delete items',
          }}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Description without {name} placeholder — renders as plain text.',
      },
    },
  },
};
