import '@testing-library/jest-dom/vitest';
import { Badge } from '@tale/ui/badge';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { cleanup } from '@testing-library/react';
import { MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Switch } from '@/app/components/ui/forms/switch';
import { render, screen } from '@/tests/utils/render';

import { createSelectColumn } from './column-builders';
import { DataTable } from './data-table';
import type { DataTableSkeleton } from './data-table-skeleton-cell';

import '@/app/globals.css';

// The table reads the org from the route for its error boundary; there is no
// router under a component test.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

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

describe('DataTable skeleton geometry (real layout)', () => {
  const patterns: {
    name: string;
    skeleton: DataTableSkeleton;
    content: ReactNode;
  }[] = [
    {
      name: 'product image with one label',
      skeleton: { type: 'avatar-text' },
      content: (
        <HStack gap={3}>
          <span className="size-8 rounded" />
          <Text variant="label">Product name</Text>
        </HStack>
      ),
    },
    {
      name: 'automation icon, name and slug',
      skeleton: { type: 'icon-text', lines: 2 },
      content: (
        <HStack gap={2}>
          <span className="size-4 rounded" />
          <Stack gap={0}>
            <Text variant="label">Automation name</Text>
            <Text variant="caption">automation-slug</Text>
          </Stack>
        </HStack>
      ),
    },
    {
      name: 'audit actor and identifier',
      skeleton: { type: 'two-line', lineGap: 0.5 },
      content: (
        <div className="flex flex-col gap-0.5">
          <Text>actor@example.test</Text>
          <Text variant="caption">actor-id</Text>
        </div>
      ),
    },
    {
      name: 'legal-hold target badge and identifier',
      skeleton: { type: 'badge-text' },
      content: (
        <Stack gap={0}>
          <Badge className="self-start">Document</Badge>
          <Text variant="caption">document-id</Text>
        </Stack>
      ),
    },
    {
      name: 'sandbox runtime badge and quota status',
      skeleton: {
        type: 'badge-text',
        lineGap: 1,
        badge: { variant: 'blue' },
      },
      content: (
        <Stack gap={1}>
          <HStack gap={1}>
            <Badge variant="blue">Running</Badge>
          </HStack>
          <Text variant="caption">Quota in use</Text>
        </Stack>
      ),
    },
  ];

  it.each(patterns)(
    'preserves the height of $name cells',
    ({ skeleton, content }) => {
      const patternColumns: ColumnDef<Row>[] = [
        {
          accessorKey: 'name',
          header: 'Name',
          meta: { skeleton },
          cell: () => content,
        },
      ];
      const table = (loading: boolean) => (
        <div style={{ width: 480 }}>
          <DataTable
            columns={patternColumns}
            data={loading ? [] : rows}
            approxRowCount={1}
            isLoading={loading}
          />
        </div>
      );
      const { container, rerender } = render(table(true));
      const measure = () =>
        container.querySelector('tbody')?.getBoundingClientRect().toJSON();
      const before = measure();
      rerender(table(false));
      expect(measure()).toEqual(before);
    },
  );

  const skeletonColumns: ColumnDef<Row>[] = [
    createSelectColumn<Row>(),
    {
      accessorKey: 'name',
      header: 'Name',
      size: 240,
      meta: { skeleton: { type: 'two-line' } },
      cell: ({ row }) => (
        <Stack gap={0}>
          <Text as="span" variant="label">
            {row.original.name}
          </Text>
          <Text as="span" variant="caption">
            {row.original.note}
          </Text>
        </Stack>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      size: 160,
      meta: { skeleton: { type: 'badge' }, align: 'center' },
      cell: ({ row }) => <Badge>{row.original.status}</Badge>,
    },
    {
      id: 'actions',
      size: 56,
      meta: { isAction: true },
      cell: () => <IconButton icon={MoreVertical} aria-label="Row actions" />,
    },
  ];
  const skeletonRows: Row[] = [
    { _id: '1', name: 'Alice', status: 'active', note: 'alice@example.test' },
    { _id: '2', name: 'Bob', status: 'active', note: 'bob@example.test' },
  ];

  it.each([320, 960])(
    'keeps multi-line row heights and column positions at %ipx when loading resolves',
    (width) => {
      const table = (loading: boolean) => (
        <div style={{ width }}>
          <DataTable
            columns={skeletonColumns}
            data={loading ? [] : skeletonRows}
            approxRowCount={2}
            isLoading={loading}
            enableRowSelection
          />
        </div>
      );
      const { container, rerender } = render(table(true));
      const measure = () =>
        Array.from(container.querySelectorAll('tbody tr')).map((row) => ({
          height: row.getBoundingClientRect().height,
          cells: Array.from(row.querySelectorAll('td')).map((cell) => ({
            x: cell.getBoundingClientRect().x,
            width: cell.getBoundingClientRect().width,
          })),
        }));
      const before = measure();
      rerender(table(false));
      expect(measure()).toEqual(before);
    },
  );

  it.each(['light', 'dark'])(
    'matches the real checkbox, switch, badge and action surfaces in %s mode',
    (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const controls: ColumnDef<Row>[] = [
        createSelectColumn<Row>(),
        { accessorKey: 'name', header: 'Name', size: 200 },
        {
          accessorKey: 'status',
          header: 'Status',
          size: 120,
          meta: { skeleton: { type: 'badge' }, align: 'center' },
          cell: () => <Badge>Active</Badge>,
        },
        {
          id: 'enabled',
          header: 'Enabled',
          size: 100,
          meta: { skeleton: { type: 'switch' }, align: 'center' },
          cell: () => <Switch aria-label="Enabled" />,
        },
        {
          id: 'actions',
          size: 56,
          meta: { isAction: true },
          cell: () => (
            <IconButton icon={MoreVertical} aria-label="Row actions" />
          ),
        },
      ];
      const table = (loading: boolean) => (
        <div style={{ width: 640 }}>
          <DataTable
            columns={controls}
            data={loading ? [] : rows}
            approxRowCount={1}
            isLoading={loading}
            enableRowSelection
          />
        </div>
      );
      const { container, rerender } = render(table(true));
      const surface = (cell: number, selector: string) => {
        const cells = container.querySelectorAll('tbody td');
        const node = cells[cell]?.querySelector(selector);
        expect(node).not.toBeNull();
        if (!node) throw new Error(`Missing surface in cell ${cell}`);
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          radius: getComputedStyle(node).borderRadius,
        };
      };
      const checkbox = surface(0, '[data-skeleton-mask]');
      const badge = surface(2, '[data-skeleton-mask]');
      const toggle = surface(3, '[data-skeleton-mask]');
      const action = surface(4, '[data-skeleton-mask]');
      expect(
        container.querySelectorAll('tbody [data-skeleton-mask][inert]'),
      ).toHaveLength(4);
      rerender(table(false));
      expect(surface(0, '[role="checkbox"]')).toEqual(checkbox);
      expect(surface(3, '[role="switch"]')).toEqual(toggle);
      expect(surface(4, 'button')).toEqual(action);
      const loadedBadge = surface(2, '[title="Active"]');
      // Unknown labels need an estimated width; the known badge height, radius
      // and center must already match the loaded, centered column.
      expect(loadedBadge.height).toBe(badge.height);
      expect(loadedBadge.y).toBe(badge.y);
      expect(loadedBadge.radius).toBe(badge.radius);
      expect(loadedBadge.x + loadedBadge.width / 2).toBeCloseTo(
        badge.x + badge.width / 2,
        1,
      );
    },
  );

  it('matches compact action clusters and preserves an explicit row height', () => {
    const compact: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
      {
        id: 'actions',
        size: 100,
        meta: {
          isAction: true,
          skeleton: { actionSize: 'sm', actionCount: 2 },
        },
        cell: () => (
          <HStack gap={1}>
            <IconButton
              size="sm"
              icon={MoreVertical}
              aria-label="First action"
            />
            <IconButton
              size="sm"
              icon={MoreVertical}
              aria-label="Second action"
            />
          </HStack>
        ),
      },
    ];
    const table = (loading: boolean) => (
      <DataTable
        columns={compact}
        data={loading ? [] : rows}
        approxRowCount={1}
        isLoading={loading}
        rowClassName="h-16"
      />
    );
    const { container, rerender } = render(table(true));
    const measure = () =>
      Array.from(container.querySelectorAll('tbody button')).map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
    const before = measure();
    expect(before).toHaveLength(2);
    rerender(table(false));
    expect(measure()).toEqual(before);
  });
});
