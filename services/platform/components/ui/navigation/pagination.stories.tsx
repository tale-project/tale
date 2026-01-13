import type { Meta, StoryObj } from '@storybook/react';
import { Pagination } from './pagination';

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
import { Pagination } from '@/components/ui/navigation/pagination';

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
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/items',
        query: {},
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
      description: 'Number of items per page',
    },
    totalPages: {
      control: { type: 'number', min: 1 },
      description: 'Total number of pages (optional)',
    },
    hasNextPage: {
      control: 'boolean',
      description: 'Whether there is a next page',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Pagination>;

export const Default: Story = {
  args: {
    currentPage: 1,
    total: 100,
    pageSize: 10,
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
        story: 'Pagination on a middle page.',
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
        story: 'Next button disabled on last page.',
      },
    },
  },
};

export const SmallDataset: Story = {
  args: {
    currentPage: 1,
    total: 25,
    pageSize: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Small dataset with only 3 pages.',
      },
    },
  },
};

export const LargeDataset: Story = {
  args: {
    currentPage: 1,
    total: 1000,
    pageSize: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Large dataset with many pages.',
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
        story: 'Single page - both buttons disabled.',
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    currentPage: 1,
    total: 0,
    pageSize: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state with no items.',
      },
    },
  },
};

export const WithTotalPages: Story = {
  args: {
    currentPage: 3,
    total: 50,
    pageSize: 10,
    totalPages: 5,
  },
  parameters: {
    docs: {
      description: {
        story: 'Explicit totalPages prop for server-side pagination.',
      },
    },
  },
};

export const WithHasNextPage: Story = {
  args: {
    currentPage: 1,
    total: 50,
    pageSize: 10,
    hasNextPage: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Using hasNextPage for cursor-based pagination.',
      },
    },
  },
};

export const CustomPageSize: Story = {
  args: {
    currentPage: 1,
    total: 100,
    pageSize: 25,
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom page size of 25 items.',
      },
    },
  },
};
