import type { Meta, StoryObj } from '@storybook/react';

import {
  Eye,
  Pencil,
  Trash2,
  Copy,
  Download,
  Archive,
  Star,
} from 'lucide-react';

import { EntityRowActions } from './entity-row-actions';

const meta: Meta<typeof EntityRowActions> = {
  title: 'Data Display/DataTable/RowActions',
  component: EntityRowActions,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A dropdown menu for row-level actions in entity tables.

## Usage
\`\`\`tsx
import { EntityRowActions } from '@/app/components/ui/entity/entity-row-actions';

<EntityRowActions
  actions={[
    { key: 'view', label: 'View Details', icon: Eye, onClick: () => setViewOpen(true) },
    { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => setEditOpen(true) },
    { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => setDeleteOpen(true), destructive: true, separator: true },
  ]}
/>
\`\`\`

## Features
- Consistent UI for table row actions
- Support for destructive actions (red styling)
- Separators between action groups
- Visibility control per action
- Keyboard accessible
        `,
      },
    },
  },
  argTypes: {
    align: {
      control: 'select',
      options: ['start', 'center', 'end'],
      description: 'Dropdown alignment',
    },
    contentWidth: {
      control: 'text',
      description: 'Width class for dropdown content',
    },
  },
};

export default meta;
type Story = StoryObj<typeof EntityRowActions>;

export const Default: Story = {
  args: {
    actions: [
      {
        key: 'view',
        label: 'View Details',
        icon: Eye,
        onClick: () => alert('View clicked'),
      },
      {
        key: 'edit',
        label: 'Edit',
        icon: Pencil,
        onClick: () => alert('Edit clicked'),
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        onClick: () => alert('Delete clicked'),
        destructive: true,
      },
    ],
  },
};

export const WithSeparators: Story = {
  args: {
    actions: [
      { key: 'view', label: 'View Details', icon: Eye, onClick: () => {} },
      { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => {} },
      {
        key: 'duplicate',
        label: 'Duplicate',
        icon: Copy,
        onClick: () => {},
        separator: true,
      },
      { key: 'download', label: 'Download', icon: Download, onClick: () => {} },
      {
        key: 'archive',
        label: 'Archive',
        icon: Archive,
        onClick: () => {},
        separator: true,
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        onClick: () => {},
        destructive: true,
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Use separators to group related actions.',
      },
    },
  },
};

export const DestructiveAction: Story = {
  args: {
    actions: [
      { key: 'view', label: 'View', icon: Eye, onClick: () => {} },
      {
        key: 'delete',
        label: 'Delete permanently',
        icon: Trash2,
        onClick: () => {},
        destructive: true,
        separator: true,
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Destructive actions are styled in red.',
      },
    },
  },
};

export const DisabledActions: Story = {
  args: {
    actions: [
      { key: 'view', label: 'View Details', icon: Eye, onClick: () => {} },
      {
        key: 'edit',
        label: 'Edit',
        icon: Pencil,
        onClick: () => {},
        disabled: true,
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        onClick: () => {},
        disabled: true,
        destructive: true,
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Actions can be disabled based on permissions or state.',
      },
    },
  },
};

export const ConditionalVisibility: Story = {
  args: {
    actions: [
      {
        key: 'view',
        label: 'View Details',
        icon: Eye,
        onClick: () => {},
        visible: true,
      },
      {
        key: 'edit',
        label: 'Edit',
        icon: Pencil,
        onClick: () => {},
        visible: true,
      },
      {
        key: 'star',
        label: 'Add to Favorites',
        icon: Star,
        onClick: () => {},
        visible: false,
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        onClick: () => {},
        destructive: true,
        visible: true,
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Actions with visible: false are hidden from the menu.',
      },
    },
  },
};

export const CustomWidth: Story = {
  args: {
    actions: [
      { key: 'view', label: 'View Full Details', icon: Eye, onClick: () => {} },
      {
        key: 'download',
        label: 'Download as PDF',
        icon: Download,
        onClick: () => {},
      },
    ],
    contentWidth: 'w-[14rem]',
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom dropdown width for longer labels.',
      },
    },
  },
};

export const AlignStart: Story = {
  args: {
    actions: [
      { key: 'view', label: 'View', icon: Eye, onClick: () => {} },
      { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => {} },
    ],
    align: 'start',
  },
  parameters: {
    docs: {
      description: {
        story: 'Dropdown aligned to start.',
      },
    },
  },
};

export const InTableContext: Story = {
  render: () => (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b">
          <th className="p-2 text-left text-sm font-medium">Name</th>
          <th className="p-2 text-left text-sm font-medium">Status</th>
          <th className="w-10"></th>
        </tr>
      </thead>
      <tbody>
        {['Document 1', 'Document 2', 'Document 3'].map((name, i) => (
          <tr key={name} className="hover:bg-muted/50 border-b">
            <td className="p-2 text-sm">{name}</td>
            <td className="text-muted-foreground p-2 text-sm">
              {i === 0 ? 'Active' : i === 1 ? 'Draft' : 'Archived'}
            </td>
            <td className="p-2">
              <EntityRowActions
                actions={[
                  { key: 'view', label: 'View', icon: Eye, onClick: () => {} },
                  {
                    key: 'edit',
                    label: 'Edit',
                    icon: Pencil,
                    onClick: () => {},
                    disabled: i === 2,
                  },
                  {
                    key: 'delete',
                    label: 'Delete',
                    icon: Trash2,
                    onClick: () => {},
                    destructive: true,
                    separator: true,
                  },
                ]}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example usage in a table with row actions.',
      },
    },
  },
};

export const SingleAction: Story = {
  args: {
    actions: [
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        onClick: () => {},
        destructive: true,
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Works with a single action as well.',
      },
    },
  },
};

export const EmptyActions: Story = {
  args: {
    actions: [],
  },
  parameters: {
    docs: {
      description: {
        story: 'Returns null when no actions are visible.',
      },
    },
  },
};
