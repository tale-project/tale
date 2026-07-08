// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from '@/app/components/ui/data-table/data-table';

import type { BoundActionSpec } from './bound-button';
import {
  BOUND_ACTIONS_COLUMN_SIZE,
  buildBoundColumns,
  useBoundRowIds,
  type BoundRow,
} from './bound-columns';

// i18n → echo `<ns>.<key>` so the (mostly chrome-level) strings stay inert.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

// The rich DataTable reads the org id from route params — no router here.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

// Deterministic date formatting (the real hook needs a locale provider).
vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: (d: Date) => `fmt:${d.toISOString().slice(0, 10)}`,
  }),
}));

// BoundButton pulls the Convex dispatch chain — a label-only stub keeps the
// actions-column assertions about the CLUSTER, not the binding.
vi.mock('./bound-button', () => ({
  BoundButton: ({ action }: { action: { label?: string } }) => (
    <button type="button">{action.label}</button>
  ),
}));

const ROW: BoundRow = {
  _id: 'r1',
  title: 'Fix login',
  status: 'in_progress',
  num: 42,
  when: Date.UTC(2026, 0, 15),
  ref: 'abc123def',
  sub: 'second line',
};

function renderTable(
  columns: Parameters<typeof buildBoundColumns>[0],
  ctx?: Partial<Parameters<typeof buildBoundColumns>[1]>,
  rows: BoundRow[] = [ROW],
) {
  const defs = buildBoundColumns(columns, { rows, ...ctx });
  return render(
    <DataTable columns={defs} data={rows} getRowId={(r) => String(r._id)} />,
  );
}

describe('buildBoundColumns — column defs', () => {
  it('infers the badge kind for status/state columns', () => {
    const defs = buildBoundColumns([{ field: 'title' }, { field: 'status' }], {
      rows: [ROW],
    });
    expect(defs.map((d) => d.id)).toEqual(['title', 'status']);
    expect(defs[1]?.meta).toMatchObject({ skeleton: { type: 'badge' } });
    expect(defs[0]?.meta).not.toHaveProperty('skeleton');
  });

  it('infers columns from the first row, dropping id-like fields (max 6)', () => {
    const wide: BoundRow = {
      _id: 'x',
      organizationId: 'o',
      projectId: 'p',
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      f: 6,
      g: 7,
    };
    const defs = buildBoundColumns(undefined, { rows: [wide] });
    expect(defs.map((d) => d.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('honors declared size, flex, align, and per-kind skeleton meta', () => {
    const defs = buildBoundColumns(
      [
        { field: 'title', kind: 'two-line', size: 240, flex: true },
        { field: 'num', kind: 'number' },
        { field: 'when', kind: 'datetime', align: 'left' },
      ],
      { rows: [ROW] },
    );
    expect(defs[0]?.size).toBe(240);
    expect(defs[0]?.meta).toMatchObject({
      flex: true,
      skeleton: { type: 'two-line' },
    });
    // number/datetime right-align by default; an explicit align wins.
    expect(defs[1]?.meta).toMatchObject({ align: 'right' });
    expect(defs[2]?.meta).toMatchObject({ align: 'left' });
  });

  it('appends the actions column for view actions or injected row actions', () => {
    const action: BoundActionSpec = {
      label: 'Create task',
      path: 'tasks/public_actions:createTask',
      mode: 'action',
    };
    const withActions = buildBoundColumns([{ field: 'title' }], {
      rows: [ROW],
      actions: [action],
    });
    const last = withActions.at(-1);
    expect(last?.id).toBe('actions');
    expect(last?.size).toBe(BOUND_ACTIONS_COLUMN_SIZE);
    expect(last?.meta).toMatchObject({ isAction: true });

    const withRowActions = buildBoundColumns([{ field: 'title' }], {
      rows: [ROW],
      rowActions: { idField: '_id', render: () => null },
    });
    expect(withRowActions.at(-1)?.id).toBe('actions');

    const plain = buildBoundColumns([{ field: 'title' }], { rows: [ROW] });
    expect(plain.at(-1)?.id).toBe('title');
  });
});

describe('buildBoundColumns — rendered cells', () => {
  it('renders spec columns with raw-key headers and the status badge', () => {
    renderTable([{ field: 'title' }, { field: 'status' }]);
    expect(screen.getByRole('columnheader', { name: 'title' })).toBeVisible();
    expect(screen.getByText('Fix login')).toBeVisible();
    expect(screen.getByText('in_progress')).toBeVisible();
  });

  it('renders the literal labelKey verbatim, else the raw field key', () => {
    renderTable([{ field: 'title', labelKey: 'Title' }, { field: 'status' }]);
    expect(screen.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'status' })).toBeVisible();
  });

  it('renders number right-aligned, id mono, datetime formatted, two-line with its secondary field', () => {
    renderTable([
      { field: 'num', kind: 'number' },
      { field: 'ref', kind: 'id' },
      { field: 'when', kind: 'datetime' },
      { field: 'title', kind: 'two-line', secondaryField: 'sub' },
    ]);
    expect(screen.getByText('42')).toHaveClass('text-right');
    expect(screen.getByText('abc123def')).toBeVisible();
    expect(screen.getAllByText('fmt:2026-01-15').length).toBeGreaterThan(0);
    expect(screen.getByText('Fix login')).toBeVisible();
    expect(screen.getByText('second line')).toBeVisible();
  });

  it('lets a rowAccessory replace the status badge (status col only)', () => {
    renderTable([{ field: 'title' }, { field: 'status' }], {
      rowAccessory: {
        idField: '_id',
        // What the capacity chip does when parked: render an ambient chip
        // instead of the badge, so the row never reads as both at once.
        render: (id) => <span>chip-{id}</span>,
      },
    });
    expect(screen.getByText('chip-r1')).toBeVisible();
    // The status badge is replaced by the chip, not shown alongside it.
    expect(screen.queryByText('in_progress')).toBeNull();
    // A non-status column (title) does not carry the accessory.
    const titleCell = screen.getByText('Fix login').closest('td');
    expect(titleCell?.textContent).not.toContain('chip-');
  });

  it('falls back to the status badge when the accessory returns it', () => {
    renderTable([{ field: 'title' }, { field: 'status' }], {
      rowAccessory: {
        idField: '_id',
        // Not parked: the accessory returns the supplied badge unchanged.
        render: (_id, statusBadge) => statusBadge,
      },
    });
    expect(screen.getByText('in_progress')).toBeVisible();
  });

  it('renders literal badge valueLabels; unmapped values render raw', () => {
    renderTable(
      [
        {
          field: 'status',
          kind: 'badge',
          valueLabels: { in_progress: 'Working' },
        },
      ],
      undefined,
      [ROW, { ...ROW, _id: 'r2', status: 'weird_status' }],
    );
    expect(screen.getByText('Working')).toBeVisible();
    expect(screen.queryByText('in_progress')).not.toBeInTheDocument();
    // Fail-visible: an unmapped value keeps rendering verbatim.
    expect(screen.getByText('weird_status')).toBeVisible();
  });

  it('keeps valueLabels on the accessory-fallback status badge', () => {
    renderTable(
      [
        {
          field: 'status',
          kind: 'badge',
          valueLabels: { in_progress: 'Working' },
        },
      ],
      {
        rowAccessory: {
          idField: '_id',
          render: (_id, statusBadge) => statusBadge,
        },
      },
    );
    expect(screen.getByText('Working')).toBeVisible();
  });

  it('renders the BoundButton cluster and injected rowActions in the actions cell', () => {
    renderTable([{ field: 'title' }], {
      actions: [
        {
          label: 'Create task',
          path: 'tasks/public_actions:createTask',
          mode: 'action',
        },
      ],
      rowActions: {
        idField: '_id',
        render: (id) => <button type="button">rerun-{id}</button>,
      },
    });
    expect(screen.getByRole('button', { name: 'Create task' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'rerun-r1' })).toBeVisible();
  });

  it('omits the injected rowActions affordance when its render returns nothing', () => {
    renderTable([{ field: 'title' }], {
      rowActions: { idField: '_id', render: () => null },
    });
    expect(screen.queryByRole('button', { name: /rerun-/ })).toBeNull();
  });
});

describe('useBoundRowIds', () => {
  it('uses native ids and mints stable per-object ids otherwise', () => {
    const { result } = renderHook(() => useBoundRowIds());
    const anon1: BoundRow = { title: 'a' };
    const anon2: BoundRow = { title: 'a' };
    expect(result.current({ _id: 'x1' })).toBe('x1');
    expect(result.current({ id: 7 })).toBe('7');
    expect(result.current(anon1)).toBe(result.current(anon1));
    expect(result.current(anon1)).not.toBe(result.current(anon2));
  });
});
