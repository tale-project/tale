import type { ColumnDef } from '@tanstack/react-table';
import { describe, it, expect, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { createSelectColumn } from './column-builders';
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

// The first content column is the `auto`-width flex column (it takes the
// leftover after its siblings' proportional shares), so the explicit `size`
// is asserted on a *later* column — `name` stands in as the flex column.
// `status` declares 200 against `name`'s default 150, so its proportional
// share is 200/350 of the container.
const columnsWithSize: ColumnDef<TestRow>[] = [
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 200,
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
      expect(skeletons.length).toBe(6);
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

  describe('column width styling', () => {
    it('applies explicit column size to data row cells', () => {
      render(
        <DataTable
          columns={columnsWithSize}
          data={sampleRows}
          approxRowCount={3}
        />,
      );

      const tbody = getTbody();
      const firstDataRow = within(tbody).getAllByRole('row')[0];
      const cells = within(firstDataRow).getAllByRole('cell');
      // First content column flexes → no fixed inline width.
      expect(cells[0].style.width).toBe('');
      // A later column gets its proportional share (200 of 350 declared).
      expect(cells[1].style.width).toContain('calc');
      expect(cells[1].style.width).toContain('0.5714');
    });

    it('applies explicit column size to skeleton row cells', () => {
      render(
        <DataTable
          columns={columnsWithSize}
          data={[]}
          approxRowCount={2}
          isLoading
        />,
      );

      const skeletons = getSkeletonRows();
      const cells = within(skeletons[0]).getAllByRole('cell');
      expect(cells[1].style.width).toContain('calc');
      expect(cells[1].style.width).toContain('0.5714');
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

      // The border container has the rounded-lg border class
      const borderContainer = container.querySelector('.rounded-lg.border');
      expect(borderContainer).toBeInTheDocument();
    });
  });
});

describe('DataTable addAction contract', () => {
  it('renders the add button in the header at the default (h-9) size', () => {
    render(
      <DataTable
        columns={columns}
        data={sampleRows}
        approxRowCount={3}
        addAction={{ label: 'New customer', onClick: vi.fn() }}
      />,
    );

    const btn = screen.getByRole('button', { name: 'New customer' });
    expect(btn).toBeInTheDocument();
    // Default (h-9) size: the create action aligns with the h-9 search/filter
    // controls in the toolbar and matches the empty-state CTA — never `sm`.
    expect(btn).toHaveClass('h-9');
    expect(btn).not.toHaveClass('text-xs');
  });

  it('keeps the empty state button-less — only the header create button renders', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        approxRowCount={0}
        emptyState={{ title: 'No customers' }}
        addAction={{ label: 'New customer', onClick: vi.fn() }}
      />,
    );

    // The create affordance lives ONLY in the header; the empty body has no CTA.
    expect(
      screen.getAllByRole('button', { name: 'New customer' }),
    ).toHaveLength(1);
    expect(screen.getByText('No customers')).toBeInTheDocument();
  });

  describe('row selection', () => {
    const selectColumns: ColumnDef<TestRow>[] = [
      createSelectColumn<TestRow>(),
      { accessorKey: 'name', header: 'Name' },
    ];

    it('renders a "Select row" checkbox only on selectable rows', () => {
      render(
        <DataTable
          columns={selectColumns}
          data={sampleRows}
          approxRowCount={3}
          // Bob is non-selectable — the protected-row case.
          enableRowSelection={(row) => row.original.name !== 'Bob'}
        />,
      );

      // Alice + Charlie are selectable; Bob renders no checkbox affordance.
      expect(
        screen.getAllByRole('checkbox', { name: 'Select row' }),
      ).toHaveLength(2);
      const bobRow = screen.getByText('Bob').closest('tr');
      expect(bobRow).not.toBeNull();
      expect(
        within(bobRow as HTMLElement).queryByRole('checkbox'),
      ).not.toBeInTheDocument();
    });

    it('keeps a checkbox on every row when all rows are selectable', () => {
      render(
        <DataTable
          columns={selectColumns}
          data={sampleRows}
          approxRowCount={3}
          enableRowSelection
        />,
      );

      expect(
        screen.getAllByRole('checkbox', { name: 'Select row' }),
      ).toHaveLength(3);
    });
  });

  it('prefers an explicit actionMenu over addAction', () => {
    render(
      <DataTable
        columns={columns}
        data={sampleRows}
        approxRowCount={3}
        actionMenu={<button>Bespoke</button>}
        addAction={{ label: 'New customer', onClick: vi.fn() }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Bespoke' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'New customer' }),
    ).not.toBeInTheDocument();
  });
});
