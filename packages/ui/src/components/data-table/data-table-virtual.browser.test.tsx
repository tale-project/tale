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
const columns: ColumnDef<Project>[] = [
  createSelectColumn<Project>(),
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => <button type="button">{row.original.name}</button>,
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
}: {
  data?: Project[];
  stickyLayout?: boolean;
  enableExpanding?: boolean;
  portalActions?: boolean;
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
        columns={portalActions ? portalColumns : columns}
        data={data}
        getRowId={projectId}
        stickyLayout={stickyLayout}
        caption="Projects"
        enableRowSelection
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        enableExpanding={enableExpanding}
        renderExpandedRow={(row) => <p>Details for {row.original.name}</p>}
      />
      <output data-testid="selection">
        {Object.keys(selection).join(',')}
      </output>
    </div>
  );
}

describe('DataTable large collections in a real browser', () => {
  it('bounds 2500 project rows, reaches both ends and retains off-screen selection', async () => {
    await page.viewport(1280, 800);
    render(<ProjectTable />);
    const scroller = screen.getByTestId('data-table-scrollport');
    const table = screen.getByRole('table', { name: 'Projects' });
    await expect
      .poll(() => table.querySelectorAll('tbody tr[data-index]').length)
      .toBeLessThan(40);
    expect(table).toHaveAttribute('aria-rowcount', '2501');
    const first = screen
      .getByRole('button', { name: 'Project 0' })
      .closest('tr')!;
    expect(first).toHaveAttribute('aria-rowindex', '2');
    await userEvent.click(within(first).getByRole('checkbox'));
    expect(screen.getByTestId('selection').textContent).toBe('p0');

    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2499' }))
      .not.toBeNull();
    const last = screen
      .getByRole('button', { name: 'Project 2499' })
      .closest('tr')!;
    expect(last).toHaveAttribute('aria-rowindex', '2501');
    await userEvent.click(within(last).getByRole('checkbox'));
    expect(screen.getByTestId('selection').textContent).toBe('p0,p2499');
    expect(table.querySelectorAll('tbody tr[data-index]').length).toBeLessThan(
      45,
    );

    scroller.scrollTop = 0;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 0' }))
      .not.toBeNull();
    const restored = screen
      .getByRole('button', { name: 'Project 0' })
      .closest('tr')!;
    expect(within(restored).getByRole('checkbox')).toBeChecked();
    expect(table.querySelectorAll('tbody tr[data-index]').length).toBeLessThan(
      45,
    );
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
    const next = screen
      .getByRole('button', { name: 'Project 3' })
      .closest('tr')!;
    await userEvent.keyboard('{Tab}');
    expect(within(next).getByRole('checkbox')).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Project 3' })).toHaveFocus();
    expect(
      scroller.querySelectorAll('tbody tr[data-index]').length,
    ).toBeLessThan(45);
  });

  it('keeps a focused portaled row action open while scrolling, and releases its row after focus leaves', async () => {
    await page.viewport(1280, 800);
    render(<ProjectTable portalActions />);
    const scroller = screen.getByTestId('data-table-scrollport');
    const trigger = screen.getByRole('button', {
      name: 'Project 2',
    });
    await userEvent.click(trigger);
    const editor = screen.getByRole('textbox', { name: 'Project 2 editor' });
    await expect.poll(() => document.activeElement).toBe(editor);
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2499' }))
      .not.toBeNull();
    expect(editor).toHaveFocus();
    expect(trigger).toBeInTheDocument();
    expect(
      scroller.querySelectorAll('tbody tr[data-index]').length,
    ).toBeLessThan(45);
    screen.getByRole('button', { name: 'Project 2499' }).focus();
    await expect
      .poll(() => screen.queryByRole('textbox', { name: 'Project 2 editor' }))
      .toBeNull();
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Project 2' }))
      .toBeNull();
  });

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
      expect(table.querySelectorAll('tbody tr[data-index]')).toHaveLength(101);
      expect(table).not.toHaveAttribute('aria-rowcount');
      if (mode === 'expanded rows') {
        const first = screen
          .getByRole('button', { name: 'Project 0' })
          .closest('tr')!;
        await userEvent.click(
          within(first).getByRole('button', { name: 'Expand row' }),
        );
        expect(screen.getByText('Details for Project 0')).toBeInTheDocument();
      }
    },
  );
});
