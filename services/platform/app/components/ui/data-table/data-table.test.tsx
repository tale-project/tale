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
  const rowgroups = screen.getAllByRole('rowgroup');
  // With a header: [thead, tbody]. Initial empty hides thead → [tbody] only.
  const tbody = rowgroups.length > 1 ? rowgroups[1] : rowgroups[0];
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

    it('does not force a column-size minWidth that would scroll an empty table', () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={0}
          emptyState={{ title: 'No items found' }}
        />,
      );

      const table = container.querySelector('table');
      expect(table).not.toBeNull();
      // Content-based floor is for data/skeleton only — empty stays at 100% so
      // Sandboxes (and other wide-column settings tables) don't show a lonely
      // horizontal scrollbar under the empty state.
      expect(table).toHaveStyle({ minWidth: '100%' });
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

    it('hides column headers on the initial empty state', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          approxRowCount={0}
          emptyState={{ title: 'Empty' }}
        />,
      );

      expect(
        screen.queryByRole('columnheader', { name: 'Name' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('columnheader', { name: 'Status' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Empty')).toBeInTheDocument();
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

    it('renders action menu during loading when toolbar chrome is present', () => {
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
          actionMenu={<button>Add Item</button>}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Add Item' }),
      ).toBeInTheDocument();
    });

    it('keeps the primary action reachable on action-only headers', () => {
      // Regression: hiding the toolbar for action-only tables removed the only
      // create affordance from token sources / API keys / teams / triggers.
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
        search={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Search items...',
        }}
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

  it('moves addAction into the empty state when there is no toolbar chrome', () => {
    const onClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[]}
        approxRowCount={0}
        emptyState={{ title: 'No customers' }}
        addAction={{ label: 'New customer', onClick }}
      />,
    );

    // No column header row on the initial empty surface.
    expect(
      screen.queryByRole('columnheader', { name: 'Name' }),
    ).not.toBeInTheDocument();
    // Create lives with the empty copy — not a lone toolbar button.
    expect(
      screen.getAllByRole('button', { name: 'New customer' }),
    ).toHaveLength(1);
    expect(screen.getByText('No customers')).toBeInTheDocument();
  });

  it('keeps addAction in the header when search chrome is present', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        approxRowCount={0}
        emptyState={{ title: 'No customers' }}
        search={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Search items...',
        }}
        addAction={{ label: 'New customer', onClick: vi.fn() }}
      />,
    );

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
        search={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Search items...',
        }}
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

describe('DataTable entity count footer (#2646)', () => {
  it('pluralizes the entity noun for a single row when given { one, other }', () => {
    render(
      <DataTable
        columns={columns}
        data={[sampleRows[0]]}
        approxRowCount={1}
        infiniteScroll={{
          hasMore: false,
          onLoadMore: vi.fn(),
          entityLabel: { one: 'project', other: 'projects' },
        }}
      />,
    );

    expect(screen.getByText('Showing all 1 project')).toBeInTheDocument();
  });

  it('keeps the plural noun for more than one row', () => {
    render(
      <DataTable
        columns={columns}
        data={sampleRows}
        approxRowCount={3}
        infiniteScroll={{
          hasMore: false,
          onLoadMore: vi.fn(),
          entityLabel: { one: 'project', other: 'projects' },
        }}
      />,
    );

    expect(screen.getByText('Showing all 3 projects')).toBeInTheDocument();
  });

  it('falls back to the legacy plural-only string for unmigrated callers', () => {
    render(
      <DataTable
        columns={columns}
        data={[sampleRows[0]]}
        approxRowCount={1}
        infiniteScroll={{
          hasMore: false,
          onLoadMore: vi.fn(),
          entityLabel: 'projects',
        }}
      />,
    );

    // Documents the still-imperfect (but unchanged) output for callers that
    // haven't migrated to `{ one, other }` yet — not the desired end state.
    expect(screen.getByText('Showing all 1 projects')).toBeInTheDocument();
  });

  it('pluralizes off the total (not the filtered count) for a filtered subset', () => {
    render(
      <DataTable
        columns={columns}
        data={[sampleRows[0]]}
        approxRowCount={1}
        infiniteScroll={{
          hasMore: false,
          onLoadMore: vi.fn(),
          entityLabel: { one: 'project', other: 'projects' },
          totalCount: 5,
        }}
      />,
    );

    expect(screen.getByText('Showing 1 of 5 projects')).toBeInTheDocument();
  });
});

describe('DataTable non-sticky wheel scroll', () => {
  it('chains vertical wheel scroll from the table frame to a scrollable ancestor', () => {
    const scrollParent = document.createElement('div');
    scrollParent.style.height = '200px';
    scrollParent.style.overflow = 'auto';
    Object.defineProperty(scrollParent, 'scrollHeight', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(scrollParent, 'clientHeight', {
      value: 200,
      configurable: true,
    });
    let top = 0;
    Object.defineProperty(scrollParent, 'scrollTop', {
      get: () => top,
      set: (value: number) => {
        top = value;
      },
      configurable: true,
    });

    const inner = document.createElement('div');
    inner.style.height = '800px';

    scrollParent.appendChild(inner);
    document.body.appendChild(scrollParent);

    render(
      <DataTable columns={columns} data={sampleRows} approxRowCount={3} />,
      { container: inner },
    );

    const trap = inner.querySelector('.overflow-x-auto');
    expect(trap).toBeInstanceOf(HTMLElement);
    if (!(trap instanceof HTMLElement)) return;
    Object.defineProperty(trap, 'scrollHeight', {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(trap, 'clientHeight', {
      value: 400,
      configurable: true,
    });

    trap.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 48, bubbles: true, cancelable: true }),
    );

    expect(scrollParent.scrollTop).toBe(48);
  });
});

describe('DataTable row expansion panel', () => {
  it('contains wide expanded content instead of letting the card clip it', async () => {
    const { user } = render(
      <DataTable
        columns={columns}
        data={sampleRows}
        approxRowCount={3}
        enableExpanding
        renderExpandedRow={() => <div data-testid="run-panel">panel body</div>}
      />,
    );

    await user.click(screen.getByText('Alice'));
    const panel = screen.getByTestId('run-panel');

    // jsdom does no layout, so pin the containment contract on the wrapper:
    // min-w-0 defeats the grid item's min-width:auto — without it, unbreakable
    // content (mono transcript lines, long ids) inflated the panel past the
    // cell and the card's overflow-hidden cut off the right edge (Stop/Re-run
    // buttons, status badges). overflow-x-auto scrolls genuinely rigid content
    // locally. Layout behavior verified in a real browser.
    const wrapper = panel.parentElement;
    expect(wrapper).toHaveClass('min-w-0');
    expect(wrapper).toHaveClass('overflow-x-auto');
  });

  it('splits chevron expand from row onRowClick when both are armed', async () => {
    const onRowClick = vi.fn();
    const { user } = render(
      <DataTable
        columns={columns}
        data={sampleRows}
        approxRowCount={3}
        enableExpanding
        onRowClick={onRowClick}
        renderExpandedRow={() => <div data-testid="run-panel">panel body</div>}
      />,
    );

    await user.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('run-panel')).not.toBeInTheDocument();

    onRowClick.mockClear();
    const expandButton = screen.getAllByRole('button', {
      name: 'Expand row',
    })[0];
    if (expandButton === undefined) {
      throw new Error('expected Expand row button');
    }
    await user.click(expandButton);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('run-panel')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Collapse row' })[0],
    ).toBeInTheDocument();
  });
});

describe('DataTable column alignment', () => {
  it('applies meta.align to loaded body cells, not just skeleton placeholders', () => {
    const alignColumns: ColumnDef<TestRow>[] = [
      { accessorKey: 'name', header: 'Name' },
      {
        accessorKey: 'status',
        header: 'Status',
        meta: { align: 'right' },
      },
    ];

    render(
      <DataTable columns={alignColumns} data={sampleRows} approxRowCount={3} />,
    );

    const statusCell = screen.getAllByText('active')[0]?.closest('td');
    expect(statusCell).toHaveClass('text-right');
  });
});
