import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';

import { DataTableFilters, type FilterConfig } from './data-table-filters';

const sampleFilters: FilterConfig[] = [
  {
    key: 'status',
    title: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'pending', label: 'Pending' },
    ],
    selectedValues: [],
    onChange: () => {},
  },
  {
    key: 'role',
    title: 'Role',
    options: [
      { value: 'admin', label: 'Admin' },
      { value: 'member', label: 'Member' },
      { value: 'viewer', label: 'Viewer' },
    ],
    selectedValues: [],
    onChange: () => {},
  },
];

const gridFilter: FilterConfig = {
  key: 'category',
  title: 'Category',
  options: [
    { value: 'electronics', label: 'Electronics' },
    { value: 'clothing', label: 'Clothing' },
    { value: 'books', label: 'Books' },
    { value: 'food', label: 'Food' },
  ],
  selectedValues: [],
  onChange: () => {},
  grid: true,
};

const meta: Meta<typeof DataTableFilters> = {
  title: 'Data Display/DataTable/Filters',
  component: DataTableFilters,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Composable filter bar for DataTable with search, multi-select filter dropdowns, date range, and clear-all support.

## Usage
\`\`\`tsx
import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';

<DataTableFilters
  search={{ value: '', onChange: setValue, placeholder: 'Search...' }}
  filters={filterConfigs}
  onClearAll={handleClearAll}
/>
\`\`\`

## Accessibility
- Search input has a placeholder for guidance
- Filter button indicates active state visually and via indicator dot
- Checkbox options are associated with labels
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DataTableFilters>;

export const Default: Story = {
  render: function Render() {
    const [search, setSearch] = useState('');
    const [statusValues, setStatusValues] = useState<string[]>([]);
    const [roleValues, setRoleValues] = useState<string[]>([]);

    const filters: FilterConfig[] = [
      {
        ...sampleFilters[0],
        selectedValues: statusValues,
        onChange: setStatusValues,
      },
      {
        ...sampleFilters[1],
        selectedValues: roleValues,
        onChange: setRoleValues,
      },
    ];

    return (
      <DataTableFilters
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search users...',
        }}
        filters={filters}
        onClearAll={() => {
          setSearch('');
          setStatusValues([]);
          setRoleValues([]);
        }}
      />
    );
  },
};

export const SearchOnly: Story = {
  render: function Render() {
    const [search, setSearch] = useState('');

    return (
      <DataTableFilters
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search products...',
        }}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Filter bar with only a search input, no dropdown filters.',
      },
    },
  },
};

export const FiltersOnly: Story = {
  render: function Render() {
    const [statusValues, setStatusValues] = useState<string[]>([]);
    const [roleValues, setRoleValues] = useState<string[]>([]);

    const filters: FilterConfig[] = [
      {
        ...sampleFilters[0],
        selectedValues: statusValues,
        onChange: setStatusValues,
      },
      {
        ...sampleFilters[1],
        selectedValues: roleValues,
        onChange: setRoleValues,
      },
    ];

    return <DataTableFilters filters={filters} />;
  },
  parameters: {
    docs: {
      description: {
        story: 'Filter bar with only dropdown filters, no search input.',
      },
    },
  },
};

export const WithActiveFilters: Story = {
  render: function Render() {
    const [search, setSearch] = useState('John');
    const [statusValues, setStatusValues] = useState<string[]>(['active']);
    const [roleValues, setRoleValues] = useState<string[]>(['admin', 'member']);

    const filters: FilterConfig[] = [
      {
        ...sampleFilters[0],
        selectedValues: statusValues,
        onChange: setStatusValues,
      },
      {
        ...sampleFilters[1],
        selectedValues: roleValues,
        onChange: setRoleValues,
      },
    ];

    return (
      <DataTableFilters
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search users...',
        }}
        filters={filters}
        onClearAll={() => {
          setSearch('');
          setStatusValues([]);
          setRoleValues([]);
        }}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Filter bar with pre-selected filters showing the active state indicator and clear button.',
      },
    },
  },
};

export const WithGridLayout: Story = {
  render: function Render() {
    const [categoryValues, setCategoryValues] = useState<string[]>([]);

    const filters: FilterConfig[] = [
      {
        ...gridFilter,
        selectedValues: categoryValues,
        onChange: setCategoryValues,
      },
    ];

    return <DataTableFilters filters={filters} />;
  },
  parameters: {
    docs: {
      description: {
        story: 'Filter section using a 2-column grid layout for options.',
      },
    },
  },
};

export const Loading: Story = {
  render: function Render() {
    const [search, setSearch] = useState('');

    const filters: FilterConfig[] = sampleFilters.map((f) => ({
      ...f,
      onChange: () => {},
    }));

    return (
      <DataTableFilters
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search...',
        }}
        filters={filters}
        isLoading
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Filter bar in a loading state, showing a spinner on the filter button.',
      },
    },
  },
};

export const WithChildren: Story = {
  render: function Render() {
    const [search, setSearch] = useState('');

    return (
      <DataTableFilters
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search...',
        }}
      >
        <span className="text-muted-foreground text-sm">3 results</span>
      </DataTableFilters>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Filter bar with additional children rendered alongside the filters.',
      },
    },
  },
};

export const Empty: Story = {
  args: {},
  parameters: {
    docs: {
      description: {
        story: 'Filter bar with no search, filters, or date range configured.',
      },
    },
  },
};
