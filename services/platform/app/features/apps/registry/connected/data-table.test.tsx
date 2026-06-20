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
