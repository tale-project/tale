import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';

import { DataTablePagination } from './data-table-pagination';

const meta: Meta<typeof DataTablePagination> = {
  title: 'Data Display/DataTable/Pagination',
  component: DataTablePagination,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Pagination component for DataTable. Supports both traditional pagination (with total count) and cursor-based pagination (with hasNextPage/hasPreviousPage).

## Usage
\`\`\`tsx
import { DataTablePagination } from '@/app/components/ui/data-table/data-table-pagination';

// Traditional pagination
<DataTablePagination
  currentPage={1}
  total={150}
  pageSize={10}
  onPageChange={setPage}
/>

// Cursor-based pagination
<DataTablePagination
  currentPage={1}
  hasNextPage={true}
  hasPreviousPage={false}
  onPageChange={setPage}
/>
\`\`\`

## Accessibility
- Previous/Next buttons have aria-labels
- Page selector is a native select element
- Loading state shown via spinner icon
        `,
      },
    },
  },
  argTypes: {
    currentPage: {
      control: { type: 'number', min: 1 },
      description: 'Current page number (1-based)',
    },
    total: {
      control: { type: 'number', min: 0 },
      description: 'Total number of items',
    },
    pageSize: {
      control: { type: 'number', min: 1 },
      description: 'Items per page',
    },
    isLoading: {
      control: 'boolean',
      description: 'Whether pagination is loading',
    },
    showPageSizeSelector: {
      control: 'boolean',
      description: 'Show page size dropdown',
    },
  },
};

export default meta;
type Story = StoryObj<typeof DataTablePagination>;

export const Default: Story = {
  args: {
    currentPage: 1,
    total: 50,
    pageSize: 10,
  },
};

export const Interactive: Story = {
  render: function InteractiveStory() {
    const [page, setPage] = useState(1);
    return (
      <DataTablePagination
        currentPage={page}
        total={150}
        pageSize={10}
        onPageChange={setPage}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive pagination with working page navigation.',
      },
    },
  },
};

export const WithPageSizeSelector: Story = {
  render: function PageSizeSelectorStory() {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    return (
      <DataTablePagination
        currentPage={page}
        total={200}
        pageSize={pageSize}
        onPageChange={setPage}
        showPageSizeSelector
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Pagination with rows-per-page selector.',
      },
    },
  },
};

export const MiddlePage: Story = {
  args: {
    currentPage: 5,
    total: 100,
    pageSize: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Showing a middle page with "Showing 41-50 of 100" text.',
      },
    },
  },
};

export const LastPage: Story = {
  args: {
    currentPage: 10,
    total: 100,
    pageSize: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Last page — next button is disabled.',
      },
    },
  },
};

export const FirstPage: Story = {
  args: {
    currentPage: 1,
    total: 100,
    pageSize: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'First page — previous button is disabled.',
      },
    },
  },
};

export const Loading: Story = {
  args: {
    currentPage: 3,
    total: 100,
    pageSize: 10,
    isLoading: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Loading state with spinner icons and disabled buttons.',
      },
    },
  },
};

export const CursorBased: Story = {
  render: function CursorBasedStory() {
    const [page, setPage] = useState(1);
    return (
      <DataTablePagination
        currentPage={page}
        hasNextPage={page < 5}
        hasPreviousPage={page > 1}
        totalPages={5}
        onPageChange={setPage}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Cursor-based pagination using hasNextPage/hasPreviousPage instead of total count.',
      },
    },
  },
};

export const SinglePage: Story = {
  args: {
    currentPage: 1,
    total: 5,
    pageSize: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Single page — both navigation buttons are disabled.',
      },
    },
  },
};

export const EmptyData: Story = {
  args: {
    currentPage: 1,
    total: 0,
    pageSize: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'No data — shows disabled navigation with no page count.',
      },
    },
  },
};
