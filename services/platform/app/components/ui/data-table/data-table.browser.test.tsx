import '@testing-library/jest-dom/vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DataTable } from './data-table';

import '@/app/globals.css';

// The table reads the org from the route for its error boundary; there is no
// router under a component test.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

afterEach(cleanup);

interface Row {
  _id: string;
  name: string;
  status: string;
  note: string;
}

const rows: Row[] = [{ _id: '1', name: 'Alice', status: 'active', note: '' }];

// Declared 100 : 300 plus the 44px pinned row-action column → a 444px floor.
const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name', size: 100 },
  { accessorKey: 'status', header: 'Status', size: 300 },
  {
    id: 'actions',
    header: '',
    size: 44,
    meta: { isAction: true },
    cell: () => null,
  },
];

function widths(): number[] {
  return screen
    .getAllByRole('columnheader')
    .map((th) => th.getBoundingClientRect().width);
}

// jsdom never lays a table out, so the one thing the width contract is about
// — what the browser actually gives each column — only a real engine can
// assert. The inline styles are unit-tested; this is the rendered truth.
describe('DataTable column widths (real layout)', () => {
  it('gives each column its declared share of the floor, the flex column the rest, and pins the action column', () => {
    render(
      <div style={{ width: 844 }}>
        <DataTable columns={columns} data={rows} approxRowCount={1} />
      </div>,
    );
    const tableWidth = screen.getByRole('table').getBoundingClientRect().width;
    const [name, status, actions] = widths();
    expect(actions).toBeCloseTo(44, 0);
    // 300 of the 444 floor, scaled to the wider table.
    expect(status).toBeCloseTo((300 / 444) * tableWidth, 0);
    // The auto flex column absorbs what the pinned px leaves over — and is
    // never squeezed below its own declared share.
    expect(name).toBeCloseTo(tableWidth - 44 - (status ?? 0), 0);
    expect(name).toBeGreaterThan((100 / 444) * tableWidth);
  });

  it('floors every column at its declared px and scrolls instead of squashing', () => {
    render(
      <div style={{ width: 300 }}>
        <DataTable columns={columns} data={rows} approxRowCount={1} />
      </div>,
    );
    const [name, status, actions] = widths();
    expect(name).toBeCloseTo(100, 0);
    expect(status).toBeCloseTo(300, 0);
    expect(actions).toBeCloseTo(44, 0);
    expect(screen.getByRole('table').getBoundingClientRect().width).toBeCloseTo(
      444,
      0,
    );
  });

  it('clips a header label that outgrows its column inside its own cell', () => {
    const cramped: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name', size: 200 },
      {
        accessorKey: 'status',
        header: 'A header label far wider than its column',
        size: 80,
      },
      { accessorKey: 'note', header: 'Note', size: 200 },
    ];
    render(
      <div style={{ width: 480 }}>
        <DataTable columns={cramped} data={rows} approxRowCount={1} />
      </div>,
    );
    const wide = screen.getByRole('columnheader', {
      name: 'A header label far wider than its column',
    });
    // The label does not fit …
    expect(wide.scrollWidth).toBeGreaterThan(wide.clientWidth);
    // … and stays inside its cell (ellipsis) instead of painting over the
    // neighbouring header.
    const style = getComputedStyle(wide);
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
    expect(style.whiteSpace).toBe('nowrap');
  });
});
