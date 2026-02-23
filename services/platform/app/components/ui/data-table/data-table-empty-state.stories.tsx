import type { Meta, StoryObj } from '@storybook/react';

import { Package, Users, FileText } from 'lucide-react';

import { DataTableEmptyState } from './data-table-empty-state';

const meta: Meta<typeof DataTableEmptyState> = {
  title: 'Data Display/DataTable/EmptyState',
  component: DataTableEmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Empty state component for DataTable. Used for both initial empty states (no data)
and filtered empty states (no results matching filters).

The initial empty state always takes priority — it is shown regardless of active
filters or search queries.

## Usage
\`\`\`tsx
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';

<DataTableEmptyState
  icon={Users}
  title="No customers yet"
  description="Add your first customer to get started."
/>
\`\`\`

## Accessibility
- Uses semantic heading hierarchy
- Icon is decorative (\`aria-hidden\`)
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
      <div className="h-[300px]">
        <Story />
      </div>
    ),
  ],
};

export const WithoutIcon: Story = {
  args: {
    title: 'No results found',
    description: 'Try adjusting your search or filter criteria.',
  },
  decorators: [
    (Story) => (
      <div className="h-[300px]">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Used for filtered empty states when no results match the current search or filters.',
      },
    },
  },
};

export const WithIcon: Story = {
  args: {
    icon: Users,
    title: 'No customers yet',
    description:
      'Import customers or add them manually to start managing your relationships.',
  },
  decorators: [
    (Story) => (
      <div className="h-[300px]">
        <Story />
      </div>
    ),
  ],
};

export const TitleOnly: Story = {
  args: {
    icon: FileText,
    title: 'No documents',
  },
  decorators: [
    (Story) => (
      <div className="h-[300px]">
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
