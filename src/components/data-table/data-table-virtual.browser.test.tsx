import '@testing-library/jest-dom/vitest';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen, within } from '@/tests/utils/render';

import { Popover } from '../overlays/popover';
import { createSelectColumn } from './column-builders';
import { DataTable } from './data-table';

import '../../globals.css';

vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org_test' }),
}));

afterEach(cleanup);

interface Project {
  id: string;
  name: string;
}

const projects: Project[] = Array.from({ length: 2500 }, (_, index) => ({
  id: `p${index}`,
  name: `Project ${index}`,
}));
const projectId = (project: Project) => project.id;
const loadMore = vi.fn();
// Called each time React renders a name cell: a table that renders again
// renders the cells of every row it has mounted.
const nameCellRendered = vi.fn();
const columns: ColumnDef<Project>[] = [
  createSelectColumn<Project>(),
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => {
      nameCellRendered();
      return <button type="button">{row.original.name}</button>;
    },
  },
];
// Every odd project is a tall row, more than twice the 48px estimate.
const mixedHeightColumns: ColumnDef<Project>[] = [
  createSelectColumn<Project>(),
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <button
        type="button"
        style={{ height: Number(row.original.id.slice(1)) % 2 ? 100 : 24 }}
      >
        {row.original.name}
      </button>
    ),
  },
];
const portalColumns: ColumnDef<Project>[] = [
  createSelectColumn<Project>(),
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <Popover
        aria-label={`${row.original.name} actions`}
        trigger={<button type="button">{row.original.name}</button>}
      >
        <input aria-label={`${row.original.name} editor`} />
      </Popover>
    ),
  },
];

function ProjectTable({
  data = projects,
  stickyLayout = true,
  enableExpanding = false,
  portalActions = false,
  mixedHeights = false,
  hasMore,
}: {
  data?: Project[];
  stickyLayout?: boolean;
  enableExpanding?: boolean;
  portalActions?: boolean;
  mixedHeights?: boolean;
  /** Turns on infinite scroll, with more rows to load or none. */
  hasMore?: boolean;
}) {
  const [selection, setSelection] = useState<RowSelectionState>({});
  return (
    <div
      style={{
        width: 800,
        height: 400,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <DataTable
        columns={
          portalActions
            ? portalColumns
            : mixedHeights
              ? mixedHeightColumns
              : columns
        }
        data={data}
        getRowId={projectId}
        stickyLayout={stickyLayout}
        caption="Projects"
        enableRowSelection
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        enableExpanding={enableExpanding}
        renderExpandedRow={(row) => <p>Details for {row.original.name}</p>}
        infiniteScroll={
          hasMore === undefined
            ? undefined
            : { hasMore, onLoadMore: loadMore, autoLoad: false }
        }
      />
      <output data-testid="selection">
        {Object.keys(selection).join(',')}
      </output>
    </div>
  );
}

// Rows are found by what they show: an attribute the windowing adds would
// find no rows at all in a table that renders every one of them.
const mountedProjects = () =>
  screen.queryAllByRole('button', { name: /^Project \d+$/ });

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function rowOf(name: string) {
  const row = screen.getByRole('button', { name }).closest('tr');
  if (row === null) throw new Error(`${name} has no row`);
  return row;
}

function isInView(element: Element, scroller: Element) {
  const view = scroller.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
}

describe('DataTable large collections in a real browser', () => {
  it('bounds 2500 project rows, reaches both ends and retains off-screen selection', async () => {
    await page.viewport(1280, 800);
    render(<ProjectTable />);
    const scroller = screen.getByTestId('data-table-scrollport');
    const table = screen.getByRole('table', { name: 'Projects' });
    await expect.poll(() => mountedProjects().length).toBeGreaterThan(5);
    expect(mountedProjects().length).toBeLessThan(40);
    expect(
      screen.queryByRole('button', { name: 'Project 1250' }),
    ).not.toBeInTheDocument();
    expect(table).toHaveAttribute('aria-rowcount', '2501');
    const first = rowOf('Project 0');
    expect(first).toHaveAttribute('aria-rowindex', '2');
    await userEvent.click(within(first).getByRole('checkbox'));
    expect(screen.getByTestId('selection').textContent).toBe('p0');

    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2499' }))
      .not.toBeNull();
    const last = rowOf('Project 2499');
    expect(last).toHaveAttribute('aria-rowindex', '2501');
    await userEvent.click(within(last).getByRole('checkbox'));
    expect(screen.getByTestId('selection').textContent).toBe('p0,p2499');
    expect(mountedProjects().length).toBeLessThan(45);
    expect(
      screen.queryByRole('button', { name: 'Project 1250' }),
    ).not.toBeInTheDocument();

    scroller.scrollTop = 0;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 0' }))
      .not.toBeNull();
    const restored = rowOf('Project 0');
    expect(within(restored).getByRole('checkbox')).toBeChecked();
    expect(mountedProjects().length).toBeLessThan(45);
  });

  it('preserves focused row actions and keyboard traversal when scrolling far away', async () => {
    await page.viewport(1280, 800);
    render(<ProjectTable />);
    const scroller = screen.getByTestId('data-table-scrollport');
    const focused = screen.getByRole('button', { name: 'Project 2' });
    focused.focus();
    await expect.poll(() => document.activeElement).toBe(focused);
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2499' }))
      .not.toBeNull();
    expect(focused).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'Project 1250' }),
    ).not.toBeInTheDocument();
    const next = rowOf('Project 3');
    await userEvent.keyboard('{Tab}');
    expect(within(next).getByRole('checkbox')).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Project 3' })).toHaveFocus();
    expect(mountedProjects().length).toBeLessThan(45);
  });

  it('keeps typing into a focused portaled row editor while scrolling, and releases its row after focus leaves', async () => {
    await page.viewport(1280, 800);
    render(<ProjectTable portalActions />);
    const scroller = screen.getByTestId('data-table-scrollport');
    const trigger = screen.getByRole('button', {
      name: 'Project 2',
    });
    await userEvent.click(trigger);
    const editor = screen.getByRole('textbox', { name: 'Project 2 editor' });
    await expect.poll(() => document.activeElement).toBe(editor);
    await userEvent.keyboard('Renamed');
    expect(editor).toHaveValue('Renamed');
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2499' }))
      .not.toBeNull();
    expect(editor).toHaveFocus();
    expect(trigger).toBeInTheDocument();
    expect(mountedProjects().length).toBeLessThan(45);
    // The same editor goes on taking the keys, its draft intact.
    await userEvent.keyboard(' draft');
    expect(
      screen.getByRole('textbox', { name: 'Project 2 editor' }),
    ).toHaveValue('Renamed draft');
    screen.getByRole('button', { name: 'Project 2499' }).focus();
    await expect
      .poll(() => screen.queryByRole('textbox', { name: 'Project 2 editor' }))
      .toBeNull();
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2' }))
      .toBeNull();
  });

  it('keeps rows of mixed heights in place while scrolling down and back up', async () => {
    await page.viewport(1280, 800);
    render(<ProjectTable mixedHeights />);
    const scroller = screen.getByTestId('data-table-scrollport');
    const header = screen.getByRole('columnheader', { name: 'Name' });
    await expect.poll(() => mountedProjects().length).toBeGreaterThan(2);
    expect(mountedProjects().length).toBeLessThan(30);

    // Walks down in steps, so each row on the way is mounted and measured.
    // Rows placed by their 48px estimate shift under the view, which then
    // lands short of where it was scrolled.
    for (let step = 0; step < 20; step += 1) {
      scroller.scrollTop += 150;
      await nextFrame();
      await nextFrame();
    }
    expect(Math.abs(scroller.scrollTop - 3000)).toBeLessThanOrEqual(1);
    const headerBottom = header.getBoundingClientRect().bottom;
    const anchor = mountedProjects().find(
      (button) => button.getBoundingClientRect().top >= headerBottom,
    );
    if (anchor === undefined) throw new Error('No row below the header');
    const placeOf = (element: Element) =>
      element.getBoundingClientRect().top + scroller.scrollTop;
    const anchorPlace = placeOf(anchor);

    // Backs up over measured rows: the view stays where it was scrolled and
    // the rows in it keep their place.
    const target = scroller.scrollTop - 150;
    scroller.scrollTop = target;
    for (let frame = 0; frame < 4; frame += 1) {
      await nextFrame();
      expect(Math.abs(scroller.scrollTop - target)).toBeLessThanOrEqual(1);
    }
    expect(anchor.isConnected).toBe(true);
    expect(Math.abs(placeOf(anchor) - anchorPlace)).toBeLessThanOrEqual(1);

    await expect
      .poll(() => {
        scroller.scrollTop = scroller.scrollHeight;
        const last = screen.queryByRole('button', { name: 'Project 2499' });
        return last !== null && isInView(last, scroller);
      })
      .toBe(true);
    expect(mountedProjects().length).toBeLessThan(30);
  });

  it('pins a row focused before the table grew into a window', async () => {
    await page.viewport(1280, 800);
    const { rerender } = render(<ProjectTable data={projects.slice(0, 100)} />);
    const focused = screen.getByRole('button', { name: 'Project 50' });
    focused.focus();
    rerender(<ProjectTable />);
    await expect.poll(() => mountedProjects().length).toBeLessThan(40);
    const scroller = screen.getByTestId('data-table-scrollport');
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2499' }))
      .not.toBeNull();
    expect(focused).toBeInTheDocument();
    expect(focused).toHaveFocus();
  });

  it('pins the row focused at the index another row held before a reorder', async () => {
    await page.viewport(1280, 800);
    const { rerender } = render(<ProjectTable />);
    screen.getByRole('button', { name: 'Project 2' }).focus();
    // Project 9 moves up to index 2, Project 2 down to index 9.
    const reordered = projects.map((project) =>
      project.id === 'p2'
        ? { id: 'p9', name: 'Project 9' }
        : project.id === 'p9'
          ? { id: 'p2', name: 'Project 2' }
          : project,
    );
    rerender(<ProjectTable data={reordered} />);
    const moved = screen.getByRole('button', { name: 'Project 9' });
    moved.focus();
    const scroller = screen.getByTestId('data-table-scrollport');
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2499' }))
      .not.toBeNull();
    expect(moved).toBeInTheDocument();
    expect(moved).toHaveFocus();
  });

  it('counts the rows of a windowed table as unknown while more can load, then names the total', async () => {
    await page.viewport(1280, 800);
    const { rerender } = render(<ProjectTable hasMore />);
    const table = screen.getByRole('table', { name: 'Projects' });
    expect(table).toHaveAttribute('aria-rowcount', '-1');
    expect(rowOf('Project 0')).toHaveAttribute('aria-rowindex', '2');

    rerender(<ProjectTable hasMore={false} />);
    expect(table).toHaveAttribute('aria-rowcount', '2501');
  });

  it('counts the rows of a fully rendered table as unknown while more can load', async () => {
    await page.viewport(1280, 800);
    const data = projects.slice(0, 30);
    const { rerender } = render(<ProjectTable data={data} hasMore />);
    const table = screen.getByRole('table', { name: 'Projects' });
    expect(table).toHaveAttribute('aria-rowcount', '-1');

    // Every row is in the DOM, where assistive tech counts them itself.
    rerender(<ProjectTable data={data} hasMore={false} />);
    expect(table).not.toHaveAttribute('aria-rowcount');
  });

  it.each([
    'small table',
    'page scroll',
    'expanded rows',
    'short viewport',
  ] as const)(
    'moves focus across the rows of a %s without rendering them again',
    async (mode) => {
      await page.viewport(1280, mode === 'short viewport' ? 360 : 800);
      render(
        <ProjectTable
          data={projects.slice(0, mode === 'small table' ? 30 : 101)}
          stickyLayout={mode !== 'page scroll'}
          enableExpanding={mode === 'expanded rows'}
        />,
      );
      screen.getByRole('button', { name: 'Project 0' }).focus();
      await nextFrame();
      nameCellRendered.mockClear();
      // A row's tab stops: its expander, its checkbox and its name.
      const stopsPerRow = mode === 'expanded rows' ? 3 : 2;
      for (let stop = 0; stop < 3 * stopsPerRow; stop += 1) {
        await userEvent.keyboard('{Tab}');
      }
      await nextFrame();
      expect(screen.getByRole('button', { name: 'Project 3' })).toHaveFocus();
      expect(nameCellRendered).not.toHaveBeenCalled();
    },
  );

  it.each(['page scroll', 'expanded rows', 'short viewport'] as const)(
    'retains the full row DOM for %s mode',
    async (mode) => {
      await page.viewport(1280, mode === 'short viewport' ? 360 : 800);
      const data = projects.slice(0, 101);
      render(
        <ProjectTable
          data={data}
          stickyLayout={mode !== 'page scroll'}
          enableExpanding={mode === 'expanded rows'}
        />,
      );
      const table = screen.getByRole('table', { name: 'Projects' });
      expect(mountedProjects()).toHaveLength(101);
      expect(table).not.toHaveAttribute('aria-rowcount');
      if (mode === 'expanded rows') {
        const first = rowOf('Project 0');
        await userEvent.click(
          within(first).getByRole('button', { name: 'Expand row' }),
        );
        expect(screen.getByText('Details for Project 0')).toBeInTheDocument();
      }
    },
  );
});
