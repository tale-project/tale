import type { ColumnDef } from '@tanstack/react-table';

import { describe, it, expect, vi } from 'vitest';

import { render, screen, within } from '@/test/utils/render';

import { DataTable } from './data-table';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

interface TestRow {
  _id: string;
  name: string;
  status: string;
}

const columns: ColumnDef<TestRow>[] = [
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { skeleton: { type: 'badge' } },
  },
];

const sampleRows: TestRow[] = [
  { _id: '1', name: 'Alice', status: 'active' },
  { _id: '2', name: 'Bob', status: 'inactive' },
  { _id: '3', name: 'Charlie', status: 'active' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTbody() {
  // Both <thead> and <tbody> have role="rowgroup"; tbody is the second one
  const rowgroups = screen.getAllByRole('rowgroup');
  const tbody = rowgroups[1];
  if (!tbody) throw new Error('Could not find tbody rowgroup');
  return tbody;
}

function getSkeletonRows() {
  return within(getTbody())
    .getAllByRole('row')
    .filter((row) => row.querySelector('[class*="animate-pulse"]'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataTable loading states', () => {
  describe('count-loading state (approxRowCount=undefined + loading)', () => {
    it('renders skeleton placeholder rows when count is still loading', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={undefined}
          isLoading
        />,
      );

      const skeletons = getSkeletonRows();
      expect(skeletons.length).toBe(3);
    });
  });

  describe('skeleton state (approxRowCount > 0 + loading)', () => {
    it('renders skeleton rows matching approxRowCount', () => {
      render(
        <DataTable columns={columns} data={[]} approxRowCount={5} isLoading />,
      );

      const skeletons = getSkeletonRows();
      expect(skeletons.length).toBe(5);
    });

    it('renders skeleton rows with infiniteScroll.isInitialLoading', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={8}
          infiniteScroll={{
            hasMore: true,
            onLoadMore: vi.fn(),
            isInitialLoading: true,
          }}
        />,
      );

      const skeletons = getSkeletonRows();
      expect(skeletons.length).toBe(8);
    });
  });

  describe('empty state (approxRowCount=0 + emptyState config)', () => {
    it('shows empty state immediately when count is 0', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={0}
          emptyState={{
            title: 'No items found',
            description: 'Create your first item.',
          }}
        />,
      );

      expect(screen.getByText('No items found')).toBeInTheDocument();
      expect(screen.getByText('Create your first item.')).toBeInTheDocument();
      expect(getSkeletonRows().length).toBe(0);
    });

    it('shows empty state when not loading and data is empty', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          emptyState={{
            title: 'Nothing here',
          }}
        />,
      );

      expect(screen.getByText('Nothing here')).toBeInTheDocument();
    });
  });

  describe('filtered-empty state (active filters + no data)', () => {
    it('shows filtered empty state when search has a value and data is empty', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          search={{
            value: 'nonexistent',
            onChange: vi.fn(),
            placeholder: 'Search...',
          }}
        />,
      );

      // The filtered empty state uses translation keys; check for the no-results message
      const rows = within(getTbody()).getAllByRole('row');
      // Should have a single row with the empty state content, no skeleton rows
      expect(rows.length).toBe(1);
      expect(getSkeletonRows().length).toBe(0);
    });
  });

  describe('data state', () => {
    it('renders data rows when items are loaded', () => {
      render(
        <DataTable columns={columns} data={sampleRows} approxRowCount={3} />,
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Charlie')).toBeInTheDocument();
      expect(getSkeletonRows().length).toBe(0);
    });
  });

  describe('structural chrome always renders', () => {
    it('renders column headers during loading', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={undefined}
          isLoading
        />,
      );

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders column headers with empty state', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={0}
          emptyState={{ title: 'Empty' }}
        />,
      );

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders search input during loading', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={undefined}
          isLoading
          search={{
            value: '',
            onChange: vi.fn(),
            placeholder: 'Search items...',
          }}
        />,
      );

      expect(
        screen.getByPlaceholderText('Search items...'),
      ).toBeInTheDocument();
    });

    it('renders action menu during loading', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={undefined}
          isLoading
          actionMenu={<button>Add Item</button>}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Add Item' }),
      ).toBeInTheDocument();
    });

    it('renders table border container during loading', () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={undefined}
          isLoading
        />,
      );

      // The border container has the rounded-xl border class
      const borderContainer = container.querySelector('.rounded-xl.border');
      expect(borderContainer).toBeInTheDocument();
    });
  });
});
