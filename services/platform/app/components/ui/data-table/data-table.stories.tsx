import type { Meta, StoryObj } from '@storybook/react';
import type { ColumnDef } from '@tanstack/react-table';

import { Plus, Download, Filter } from 'lucide-react';
import { useState } from 'react';

import { TableDateCell } from '../data-display/table-date-cell';
import { Badge } from '../feedback/badge';
import { Button } from '../primitives/button';
import { DataTable } from './data-table';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  status: 'active' | 'inactive' | 'pending';
  createdAt: number;
}

const sampleUsers: User[] = [
  {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'admin',
    status: 'active',
    createdAt: Date.now() - 86400000 * 30,
  },
  {
    id: '2',
    name: 'Jane Smith',
    email: 'jane@example.com',
    role: 'member',
    status: 'active',
    createdAt: Date.now() - 86400000 * 20,
  },
  {
    id: '3',
    name: 'Bob Wilson',
    email: 'bob@example.com',
    role: 'viewer',
    status: 'inactive',
    createdAt: Date.now() - 86400000 * 15,
  },
  {
    id: '4',
    name: 'Alice Brown',
    email: 'alice@example.com',
    role: 'member',
    status: 'pending',
    createdAt: Date.now() - 86400000 * 10,
  },
  {
    id: '5',
    name: 'Charlie Davis',
    email: 'charlie@example.com',
    role: 'viewer',
    status: 'active',
    createdAt: Date.now() - 86400000 * 5,
  },
];

const roles: User['role'][] = ['admin', 'member', 'viewer'];
const statuses: User['status'][] = ['active', 'inactive', 'pending'];

const manyUsers: User[] = Array.from({ length: 50 }, (_, i) => ({
  id: `${i + 1}`,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  role: roles[i % 3] ?? 'member',
  status: statuses[i % 3] ?? 'active',
  createdAt: Date.now() - 86400000 * (i + 1),
}));

const columns: ColumnDef<User>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue<string>('name')}</span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.getValue<string>('email')}
      </span>
    ),
  },
  {
    accessorKey: 'role',
    header: 'Role',
    cell: ({ row }) => {
      const role = row.getValue<User['role']>('role');
      return (
        <Badge
          variant={
            role === 'admin' ? 'blue' : role === 'member' ? 'green' : 'outline'
          }
        >
          {role}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.getValue<User['status']>('status');
      return (
        <Badge
          variant={
            status === 'active'
              ? 'green'
              : status === 'pending'
                ? 'yellow'
                : 'destructive'
          }
        >
          {status}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) => (
      <TableDateCell
        date={row.getValue<number>('createdAt')}
        preset="relative"
      />
    ),
  },
];

const meta: Meta<typeof DataTable> = {
  title: 'Data Display/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A unified data table component built on TanStack Table.

## Usage
\`\`\`tsx
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { createColumnHelper } from '@tanstack/react-table';

const columnHelper = createColumnHelper<User>();
const columns = [
  columnHelper.accessor('name', { header: 'Name' }),
  columnHelper.accessor('email', { header: 'Email' }),
];

<DataTable
  columns={columns}
  data={users}
  caption="User list"
/>
\`\`\`

## Features
- Column definitions via TanStack Table
- Sorting (client-side or server-side)
- Row selection with checkboxes
- Expandable rows
- Pagination (client-side or server-side)
- Search and filters
- Empty states
- Loading skeletons
- Sticky headers
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DataTable<User>>;

export const Default: Story = {
  args: {
    columns,
    data: sampleUsers,
    caption: 'User list',
  },
};

export const WithSearch: Story = {
  render: function SearchStory() {
    const [searchValue, setSearchValue] = useState('');
    const filteredData = sampleUsers.filter(
      (user) =>
        user.name.toLowerCase().includes(searchValue.toLowerCase()) ||
        user.email.toLowerCase().includes(searchValue.toLowerCase()),
    );

    return (
      <DataTable
        columns={columns}
        data={filteredData}
        caption="Searchable user list"
        search={{
          value: searchValue,
          onChange: setSearchValue,
          placeholder: 'Search users...',
        }}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'DataTable with search functionality.',
      },
    },
  },
};

export const WithActionMenu: Story = {
  args: {
    columns,
    data: sampleUsers,
    caption: 'User list with actions',
    actionMenu: (
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" icon={Filter}>
          Filter
        </Button>
        <Button variant="secondary" size="sm" icon={Download}>
          Export
        </Button>
        <Button size="sm" icon={Plus}>
          Add User
        </Button>
      </div>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Header with action buttons.',
      },
    },
  },
};

export const WithClientPagination: Story = {
  args: {
    columns,
    data: manyUsers,
    caption: 'Paginated user list',
    pagination: {
      clientSide: true,
      pageSize: 10,
      total: manyUsers.length,
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Client-side pagination for smaller datasets.',
      },
    },
  },
};

export const WithSorting: Story = {
  render: function SortingStory() {
    const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);

    return (
      <DataTable
        columns={columns}
        data={sampleUsers}
        caption="Sortable user list"
        sorting={{
          initialSorting: sorting,
          onSortingChange: setSorting,
        }}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Click column headers to sort.',
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    columns,
    data: [],
    caption: 'Empty user list',
    emptyState: {
      title: 'No users found',
      description: 'Get started by adding your first user.',
      icon: Plus,
    },
    actionMenu: (
      <Button size="sm" icon={Plus} onClick={() => alert('Add user clicked')}>
        Add User
      </Button>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state with call to action.',
      },
    },
  },
};

export const StickyLayout: Story = {
  args: {
    columns,
    data: manyUsers.slice(0, 20),
    caption: 'Sticky header table',
    stickyLayout: true,
    pagination: {
      clientSide: true,
      pageSize: 10,
      total: 20,
    },
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
        story: 'Sticky header with scrollable content.',
      },
    },
  },
};

export const ClickableRows: Story = {
  args: {
    columns,
    data: sampleUsers,
    caption: 'Clickable rows',
    clickableRows: true,
    onRowClick: (row) => alert(`Clicked: ${row.original.name}`),
  },
  parameters: {
    docs: {
      description: {
        story: 'Rows are clickable with hover state.',
      },
    },
  },
};

export const WithInfiniteScroll: Story = {
  render: function InfiniteScrollStory() {
    const [data, setData] = useState(manyUsers.slice(0, 10));
    const [isLoading, setIsLoading] = useState(false);

    const loadMore = () => {
      setIsLoading(true);
      setTimeout(() => {
        setData((prev) => [
          ...prev,
          ...manyUsers.slice(prev.length, prev.length + 10),
        ]);
        setIsLoading(false);
      }, 1000);
    };

    return (
      <div className="h-[600px]">
        <DataTable
          columns={columns}
          data={data}
          caption="Infinite scroll table"
          stickyLayout
          infiniteScroll={{
            hasMore: data.length < manyUsers.length,
            onLoadMore: loadMore,
            isLoadingMore: isLoading,
            threshold: 200,
          }}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Automatic infinite scroll that triggers 200px before reaching the bottom.',
      },
    },
  },
};

export const WithManualLoadMore: Story = {
  render: function ManualLoadMoreStory() {
    const [data, setData] = useState(manyUsers.slice(0, 10));
    const [isLoading, setIsLoading] = useState(false);

    const loadMore = () => {
      setIsLoading(true);
      setTimeout(() => {
        setData((prev) => [
          ...prev,
          ...manyUsers.slice(prev.length, prev.length + 10),
        ]);
        setIsLoading(false);
      }, 1000);
    };

    return (
      <DataTable
        columns={columns}
        data={data}
        caption="Manual load more table"
        infiniteScroll={{
          hasMore: data.length < manyUsers.length,
          onLoadMore: loadMore,
          isLoadingMore: isLoading,
          autoLoad: false,
        }}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Manual load more button (autoLoad disabled for backward compatibility).',
      },
    },
  },
};

export const FullFeatured: Story = {
  render: function FullFeaturedStory() {
    const [searchValue, setSearchValue] = useState('');
    const filteredData = manyUsers.filter(
      (user) =>
        user.name.toLowerCase().includes(searchValue.toLowerCase()) ||
        user.email.toLowerCase().includes(searchValue.toLowerCase()),
    );

    return (
      <div className="h-[500px]">
        <DataTable
          columns={columns}
          data={filteredData}
          caption="Full featured user table"
          search={{
            value: searchValue,
            onChange: setSearchValue,
            placeholder: 'Search users...',
          }}
          actionMenu={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={Download}>
                Export
              </Button>
              <Button size="sm" icon={Plus}>
                Add User
              </Button>
            </div>
          }
          pagination={{
            clientSide: true,
            pageSize: 10,
            total: filteredData.length,
          }}
          stickyLayout
          emptyState={{
            title: 'No users found',
            description: 'Try adjusting your search.',
            icon: Filter,
          }}
          onClearFilters={() => setSearchValue('')}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Full featured example with search, pagination, and sticky layout.',
      },
    },
  },
};
