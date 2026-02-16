import type { Meta, StoryObj } from '@storybook/react';

import { Plus } from 'lucide-react';

import { DataTableActionMenu } from './data-table-action-menu';
import { DataTableSkeleton } from './data-table-skeleton';

const meta: Meta<typeof DataTableSkeleton> = {
  title: 'Data Display/DataTable/Skeleton',
  component: DataTableSkeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Loading skeleton for DataTable. Matches the DataTable layout to prevent CLS during loading.

## Skeleton types
- **text** — Default text line skeleton
- **badge** — Rounded pill for status badges
- **id-copy** — ID field with copy button
- **avatar-text** — Avatar circle with two text lines
- **action** — Right-aligned action button
- **switch** — Toggle switch skeleton

## Usage
\`\`\`tsx
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

<DataTableSkeleton
  rows={10}
  columns={[
    { header: 'Name', hasAvatar: true },
    { header: 'Email' },
    { header: 'Status', skeleton: { type: 'badge' } },
    { header: 'Actions', isAction: true },
  ]}
  searchPlaceholder="Search..."
/>
\`\`\`

## Features
- Accepts TanStack Table column definitions directly
- Configurable column widths and skeleton types
- Supports sticky layout, infinite scroll, filter and date range skeletons
- Expand column support
        `,
      },
    },
  },
  argTypes: {
    rows: {
      control: { type: 'number', min: 1, max: 20 },
      description: 'Number of skeleton rows',
    },
    showHeader: {
      control: 'boolean',
      description: 'Show table header row',
    },
    stickyLayout: {
      control: 'boolean',
      description: 'Enable sticky layout mode',
    },
    infiniteScroll: {
      control: 'boolean',
      description: 'Show load more button skeleton',
    },
    showFilters: {
      control: 'boolean',
      description: 'Show filter button skeleton',
    },
    showDateRange: {
      control: 'boolean',
      description: 'Show date range picker skeleton',
    },
    enableExpanding: {
      control: 'boolean',
      description: 'Show expand column',
    },
  },
};

export default meta;
type Story = StoryObj<typeof DataTableSkeleton>;

const basicColumns = [
  { header: 'Name', size: 200 },
  { header: 'Email', size: 250 },
  { header: 'Role', size: 120 },
  { header: 'Status', size: 120 },
  { header: 'Created', size: 150 },
];

export const Default: Story = {
  args: {
    rows: 5,
    columns: basicColumns,
  },
};

export const WithSearchAndActions: Story = {
  args: {
    rows: 8,
    columns: basicColumns,
    searchPlaceholder: 'Search users...',
    actionMenu: (
      <DataTableActionMenu label="Add user" icon={Plus} onClick={() => {}} />
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Skeleton with search input and action menu in the header.',
      },
    },
  },
};

export const AllSkeletonTypes: Story = {
  args: {
    rows: 5,
    columns: [
      { header: 'User', hasAvatar: true, size: 220 },
      { header: 'ID', skeleton: { type: 'id-copy' }, size: 180 },
      { header: 'Status', skeleton: { type: 'badge' }, size: 120 },
      { header: 'Active', skeleton: { type: 'switch' }, size: 100 },
      { header: 'Amount', align: 'right' as const, size: 120 },
      { isAction: true, size: 60 },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Demonstrates all skeleton types: avatar-text, id-copy, badge, switch, right-aligned text, and action.',
      },
    },
  },
};

export const WithFiltersAndDateRange: Story = {
  args: {
    rows: 5,
    columns: basicColumns,
    searchPlaceholder: 'Search...',
    showFilters: true,
    showDateRange: true,
    actionMenu: (
      <DataTableActionMenu
        label="Export"
        onClick={() => {}}
        variant="secondary"
      />
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Full header with search, filter button, and date range picker.',
      },
    },
  },
};

export const NoFirstColumnAvatar: Story = {
  args: {
    rows: 5,
    columns: basicColumns,
    noFirstColumnAvatar: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Disables the default avatar layout on the first column. Useful for tables without user/entity avatars.',
      },
    },
  },
};

export const InfiniteScroll: Story = {
  args: {
    rows: 5,
    columns: basicColumns,
    infiniteScroll: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Infinite scroll mode shows a load more button skeleton at the bottom.',
      },
    },
  },
};

export const WithExpandColumn: Story = {
  args: {
    rows: 5,
    columns: [
      { header: 'Name', size: 200 },
      { header: 'Details', size: 300 },
      { header: 'Status', skeleton: { type: 'badge' }, size: 120 },
    ],
    enableExpanding: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Expanding rows enabled — shows an expand indicator column.',
      },
    },
  },
};

export const StickyLayout: Story = {
  args: {
    rows: 10,
    columns: basicColumns,
    stickyLayout: true,
    searchPlaceholder: 'Search...',
  },
  decorators: [
    (Story) => (
      <div className="h-[400px]">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Sticky layout mode with fixed header. Used in pages with constrained height.',
      },
    },
  },
};

export const FewRows: Story = {
  args: {
    rows: 2,
    columns: basicColumns,
  },
  parameters: {
    docs: {
      description: {
        story: 'Minimal skeleton with only 2 rows.',
      },
    },
  },
};

export const NoHeader: Story = {
  args: {
    rows: 5,
    columns: basicColumns,
    showHeader: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Skeleton without the header row.',
      },
    },
  },
};
