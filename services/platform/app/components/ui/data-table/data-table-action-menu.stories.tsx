import type { Meta, StoryObj } from '@storybook/react';

import {
  Plus,
  Download,
  Trash2,
  Edit,
  Copy,
  MoreHorizontal,
} from 'lucide-react';

import { DataTableActionMenu } from './data-table-action-menu';

const meta: Meta<typeof DataTableActionMenu> = {
  title: 'Data Display/DataTable/ActionMenu',
  component: DataTableActionMenu,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Action menu component for DataTable headers and empty states. Supports three modes: simple button, link button, and dropdown menu.

## Usage
\`\`\`tsx
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';

<DataTableActionMenu
  label="Actions"
  menuItems={[
    { label: 'Edit', icon: Edit, onClick: handleEdit },
    { label: 'Delete', icon: Trash2, onClick: handleDelete },
  ]}
/>
\`\`\`

## Accessibility
- Dropdown trigger button has proper labelling
- Menu items are keyboard navigable
- Disabled items are marked with aria-disabled
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
        'outline',
        'secondary',
        'ghost',
        'link',
      ],
    },
    align: {
      control: 'select',
      options: ['start', 'center', 'end'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof DataTableActionMenu>;

export const SimpleButton: Story = {
  args: {
    label: 'Add user',
    icon: Plus,
    onClick: () => {},
  },
};

export const WithDropdownMenu: Story = {
  args: {
    label: 'Actions',
    icon: MoreHorizontal,
    menuItems: [
      { label: 'Edit', icon: Edit, onClick: () => {} },
      { label: 'Duplicate', icon: Copy, onClick: () => {} },
      { label: 'Export', icon: Download, onClick: () => {} },
      { label: 'Delete', icon: Trash2, onClick: () => {} },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Dropdown menu mode with multiple action items.',
      },
    },
  },
};

export const WithDisabledItems: Story = {
  args: {
    label: 'Actions',
    menuItems: [
      { label: 'Edit', icon: Edit, onClick: () => {} },
      { label: 'Delete', icon: Trash2, onClick: () => {}, disabled: true },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Dropdown menu with some items disabled.',
      },
    },
  },
};

export const DestructiveVariant: Story = {
  args: {
    label: 'Delete selected',
    icon: Trash2,
    variant: 'destructive',
    onClick: () => {},
  },
};

export const OutlineVariant: Story = {
  args: {
    label: 'Export',
    icon: Download,
    variant: 'outline',
    onClick: () => {},
  },
};

export const GhostVariant: Story = {
  args: {
    label: 'More options',
    variant: 'ghost',
    menuItems: [
      { label: 'Edit', onClick: () => {} },
      { label: 'Delete', onClick: () => {} },
    ],
  },
};

export const WithoutIcon: Story = {
  args: {
    label: 'Create new',
    onClick: () => {},
  },
  parameters: {
    docs: {
      description: {
        story: 'Simple button without an icon.',
      },
    },
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <DataTableActionMenu label="Default" icon={Plus} onClick={() => {}} />
      <DataTableActionMenu
        label="Outline"
        icon={Download}
        variant="outline"
        onClick={() => {}}
      />
      <DataTableActionMenu
        label="Secondary"
        icon={Edit}
        variant="secondary"
        onClick={() => {}}
      />
      <DataTableActionMenu
        label="Destructive"
        icon={Trash2}
        variant="destructive"
        onClick={() => {}}
      />
      <DataTableActionMenu label="Ghost" variant="ghost" onClick={() => {}} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All button variant options side by side.',
      },
    },
  },
};

export const DropdownAlignStart: Story = {
  args: {
    label: 'Actions',
    align: 'start',
    menuItems: [
      { label: 'Edit', icon: Edit, onClick: () => {} },
      { label: 'Delete', icon: Trash2, onClick: () => {} },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Dropdown aligned to the start of the trigger.',
      },
    },
  },
};

export const WithChildren: Story = {
  args: {
    label: 'Unused',
    children: (
      <div className="flex gap-2">
        <button className="rounded border px-3 py-1 text-sm">Custom A</button>
        <button className="rounded border px-3 py-1 text-sm">Custom B</button>
      </div>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'When children are provided, they render directly instead of the default button/dropdown.',
      },
    },
  },
};
