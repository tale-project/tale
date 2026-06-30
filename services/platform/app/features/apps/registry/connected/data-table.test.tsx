import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { DataTable } from './data-table';

describe('DataTable', () => {
  it('renders explicit columns as headers and their cell values', () => {
    render(
      <DataTable
        rows={[{ _id: 'r1', title: 'Fix login', status: 'open' }]}
        columns={['title', 'status']}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'title' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'status' })).toBeVisible();
    expect(screen.getByText('Fix login')).toBeVisible();
    expect(screen.getByText('open')).toBeVisible();
  });

  it('infers columns from the first row, dropping id-like fields', () => {
    render(
      <DataTable
        rows={[{ _id: 'r1', organizationId: 'org_1', name: 'Acme', count: 3 }]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'name' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'count' })).toBeVisible();
    // `_id` / `organizationId` are hidden, never shown as columns.
    expect(
      screen.queryByRole('columnheader', { name: 'organizationId' }),
    ).toBeNull();
  });

  it('expands a row on click to render the expansion content', () => {
    render(
      <DataTable
        rows={[{ _id: 'r1', title: 'Fix login' }]}
        columns={['title']}
        expansion={{
          idField: '_id',
          render: (id) => <div>detail-{id}</div>,
        }}
      />,
    );
    // Collapsed by default.
    expect(screen.queryByText('detail-r1')).toBeNull();
    fireEvent.click(screen.getByText('Fix login'));
    expect(screen.getByText('detail-r1')).toBeVisible();
    // Clicking again collapses it.
    fireEvent.click(screen.getByText('Fix login'));
    expect(screen.queryByText('detail-r1')).toBeNull();
  });

  it('lets a rowAccessory replace the status badge (status col only)', () => {
    render(
      <DataTable
        rows={[{ _id: 'r1', title: 'Fix login', status: 'in_progress' }]}
        columns={['title', 'status']}
        rowAccessory={{
          idField: '_id',
          // What the capacity chip does when parked: render an ambient chip
          // instead of the badge, so the row never reads as both at once.
          render: (id) => <span>chip-{id}</span>,
        }}
      />,
    );
    expect(screen.getByText('chip-r1')).toBeVisible();
    // The status badge is replaced by the chip, not shown alongside it.
    expect(screen.queryByText('in_progress')).toBeNull();
    // A non-status column (title) does not carry the accessory.
    const titleCell = screen.getByText('Fix login').closest('td');
    expect(titleCell?.textContent).not.toContain('chip-');
  });

  it('falls back to the status badge when the accessory returns it', () => {
    render(
      <DataTable
        rows={[{ _id: 'r1', title: 'Fix login', status: 'in_progress' }]}
        columns={['title', 'status']}
        rowAccessory={{
          idField: '_id',
          // Not parked: the accessory returns the supplied badge unchanged.
          render: (_id, statusBadge) => statusBadge,
        }}
      />,
    );
    expect(screen.getByText('in_progress')).toBeVisible();
  });

  it('shows a rowActions affordance in the actions column with no view actions', () => {
    render(
      <DataTable
        rows={[{ _id: 'r1', title: 'Fix login', status: 'in_progress' }]}
        columns={['title', 'status']}
        rowActions={{
          idField: '_id',
          // What the failed-run wrapper does: render a re-run only on the rows
          // that need it. Its presence alone makes the actions column appear.
          render: (id) => <button type="button">rerun-{id}</button>,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'rerun-r1' })).toBeVisible();
  });

  it('omits the rowActions affordance when its render returns nothing', () => {
    render(
      <DataTable
        rows={[{ _id: 'r1', title: 'Fix login', status: 'todo' }]}
        columns={['title', 'status']}
        rowActions={{ idField: '_id', render: () => null }}
      />,
    );
    expect(screen.queryByRole('button', { name: /rerun-/ })).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <DataTable
        rows={[{ _id: 'r1', title: 'Fix login', status: 'open' }]}
        columns={['title', 'status']}
      />,
    );
    await checkAccessibility(container);
  });
});
