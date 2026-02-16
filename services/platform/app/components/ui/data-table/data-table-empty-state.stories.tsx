import type { Meta, StoryObj } from '@storybook/react';

import { Package, Users, FileText, Search, Plus } from 'lucide-react';

import { DataTableActionMenu } from './data-table-action-menu';
import {
  DataTableEmptyState,
  DataTableFilteredEmptyState,
} from './data-table-empty-state';

const meta: Meta<typeof DataTableEmptyState> = {
  title: 'Data Display/DataTable/EmptyState',
  component: DataTableEmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Empty state components for DataTable. Two variants:

- **DataTableEmptyState** — Initial empty state when there's no data at all. Shows icon, title, description, and optional CTA.
- **DataTableFilteredEmptyState** — Shown when filters are applied but no results match. Includes header content slot for search/filter controls.

## Usage
\`\`\`tsx
import { DataTableEmptyState, DataTableFilteredEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';

// No data at all
<DataTableEmptyState
  icon={Users}
  title="No customers yet"
  description="Add your first customer to get started."
  actionMenu={<DataTableActionMenu label="Add customer" icon={Plus} onClick={handleAdd} />}
/>

// Filters applied, no results
<DataTableFilteredEmptyState
  title="No results found"
  description="Try adjusting your search or filters."
  headerContent={<SearchInput />}
/>
\`\`\`

## Accessibility
- Uses semantic heading hierarchy
- Icon is decorative (inside layout component)
- Action menu receives keyboard focus
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DataTableEmptyState>;

export const Default: Story = {
  args: {
    icon: Package,
    title: 'No products yet',
    description: 'Add your first product to get started.',
  },
  decorators: [
    (Story) => (
      <div className="h-[400px]">
        <Story />
      </div>
    ),
  ],
};

export const WithActionMenu: Story = {
  args: {
    icon: Users,
    title: 'No customers yet',
    description:
      'Import customers or add them manually to start managing your relationships.',
    actionMenu: (
      <DataTableActionMenu
        label="Add customer"
        icon={Plus}
        onClick={() => {}}
      />
    ),
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
        story: 'Empty state with an action button to add the first item.',
      },
    },
  },
};

export const WithoutIcon: Story = {
  args: {
    title: 'No data available',
    description: 'There is nothing to display at this time.',
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
        story: 'Empty state without an icon.',
      },
    },
  },
};

export const TitleOnly: Story = {
  args: {
    icon: FileText,
    title: 'No documents',
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
        story: 'Minimal empty state with only icon and title.',
      },
    },
  },
};

export const FilteredEmptyState: StoryObj<typeof DataTableFilteredEmptyState> =
  {
    render: () => (
      <DataTableFilteredEmptyState
        title="No results found"
        description="Try adjusting your search or filter criteria."
      />
    ),
    parameters: {
      docs: {
        description: {
          story:
            'Filtered empty state shown when search/filter produces no matches.',
        },
      },
    },
  };

export const FilteredWithHeaderContent: StoryObj<
  typeof DataTableFilteredEmptyState
> = {
  render: () => (
    <div className="flex h-[400px] flex-col">
      <DataTableFilteredEmptyState
        title="No matching customers"
        description="No customers match your current filters."
        headerContent={
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-[300px] items-center gap-2 rounded-md border px-3">
              <Search className="text-muted-foreground size-4" />
              <span className="text-muted-foreground text-sm">
                Search customers...
              </span>
            </div>
          </div>
        }
        stickyLayout
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Filtered empty state with header content (search bar) and sticky layout.',
      },
    },
  },
};
