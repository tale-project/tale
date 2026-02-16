import type { Meta, StoryObj } from '@storybook/react';

import { useSearch } from '@tanstack/react-router';

import { Pagination } from './pagination';

function PaginationWrapper({
  initialPage = 1,
  total = 100,
  pageSize = 10,
  totalPages,
  hasNextPage,
}: {
  initialPage?: number;
  total?: number;
  pageSize?: number;
  totalPages?: number;
  hasNextPage?: boolean;
}) {
  const search: Record<string, string | undefined> = useSearch({
    strict: false,
  });
  const currentPage = search.page ? parseInt(search.page) : initialPage;

  return (
    <Pagination
      currentPage={currentPage}
      total={total}
      pageSize={pageSize}
      totalPages={totalPages}
      hasNextPage={hasNextPage}
    />
  );
}

const meta: Meta<typeof Pagination> = {
  title: 'Navigation/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A pagination component with page navigation and page size selection.

## Usage
\`\`\`tsx
import { Pagination } from '@/app/components/ui/navigation/pagination';

<Pagination
  currentPage={1}
  total={100}
  pageSize={10}
/>
\`\`\`

## Features
- Previous/Next buttons with loading states
- Page selector dropdown
- Shows current range and total count
- URL-based navigation (updates search params)
- Optional query string preservation
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Pagination>;

export const Default: Story = {
  render: () => <PaginationWrapper total={100} pageSize={10} />,
};

export const MiddlePage: Story = {
  render: () => <PaginationWrapper initialPage={5} total={100} pageSize={10} />,
  parameters: {
    docs: {
      description: {
        story: 'Pagination starting on a middle page.',
      },
    },
  },
};

export const LastPage: Story = {
  render: () => (
    <PaginationWrapper initialPage={10} total={100} pageSize={10} />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Next button disabled on last page.',
      },
    },
  },
};

export const SmallDataset: Story = {
  render: () => <PaginationWrapper total={25} pageSize={10} />,
  parameters: {
    docs: {
      description: {
        story: 'Small dataset with only 3 pages.',
      },
    },
  },
};

export const LargeDataset: Story = {
  render: () => <PaginationWrapper total={1000} pageSize={10} />,
  parameters: {
    docs: {
      description: {
        story: 'Large dataset with many pages.',
      },
    },
  },
};

export const SinglePage: Story = {
  render: () => <PaginationWrapper total={5} pageSize={10} />,
  parameters: {
    docs: {
      description: {
        story: 'Single page - both buttons disabled.',
      },
    },
  },
};

export const EmptyState: Story = {
  render: () => <PaginationWrapper total={0} pageSize={10} />,
  parameters: {
    docs: {
      description: {
        story: 'Empty state with no items - all controls disabled.',
      },
    },
  },
};

export const WithTotalPages: Story = {
  render: () => (
    <PaginationWrapper
      initialPage={3}
      total={50}
      pageSize={10}
      totalPages={5}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Explicit totalPages prop for server-side pagination.',
      },
    },
  },
};

export const WithHasNextPage: Story = {
  render: () => (
    <PaginationWrapper total={50} pageSize={10} hasNextPage={true} />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Using hasNextPage for cursor-based pagination.',
      },
    },
  },
};

export const CustomPageSize: Story = {
  render: () => <PaginationWrapper total={100} pageSize={25} />,
  parameters: {
    docs: {
      description: {
        story: 'Custom page size of 25 items.',
      },
    },
  },
};
