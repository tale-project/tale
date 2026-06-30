// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundPaginatedQueryResult } from '../../hooks/use-bound-paginated-query';
import { Collection } from './collection';

// Stand in for the Radix dropdown (portals/pointer-events are flaky in jsdom):
// render the trigger plus one button per radio option that fires onValueChange,
// so the filter merge can be driven directly.
vi.mock('@tale/ui/dropdown-menu', () => ({
  DropdownMenu: ({
    trigger,
    items,
  }: {
    trigger: ReactNode;
    items: DropdownMenuGroup[];
  }) => {
    const radio = items.flat().find((i) => i.type === 'radio-group');
    return (
      <div>
        {trigger}
        {radio?.type === 'radio-group' &&
          radio.options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => radio.onValueChange(o.value)}
            >
              {`opt:${o.value}`}
            </button>
          ))}
      </div>
    );
  },
}));

// i18n → echo `apps.<key>`, interpolating params, so assertions read clearly.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`{${k}}`, v),
            `${ns}.${key}`,
          )
        : `${ns}.${key}`,
  }),
}));

vi.mock('../../runtime/app-runtime', () => ({
  usePackLabelString: () => (s?: string) => s ?? '',
  resolveColumnLabels: (labels?: Record<string, string>) => labels ?? {},
  useAppRuntime: () => ({}),
}));

// Subject expansion/accessory are domain components pulling in reactive deps;
// never exercised here (no `subjectType`), so stub them to keep the import light.
vi.mock('./subject-run', () => ({ SubjectRun: () => null }));
vi.mock('./subject-run-status-chip', () => ({
  SubjectRunStatusChip: () => null,
}));
vi.mock('./subject-rerun-action', () => ({
  SubjectRerunAction: () => null,
}));

// The paginated data hook — drive it by hand per test. Keep the REAL DataTable
// so the maxRows / no-truncation assertion is meaningful. Capture the args it
// receives so the filter-merge can be asserted.
let paginatedReturn: BoundPaginatedQueryResult;
let lastPaginatedArgs: unknown;
vi.mock('../../hooks/use-bound-paginated-query', () => ({
  useBoundPaginatedQuery: (_path: string, args: unknown) => {
    lastPaginatedArgs = args;
    return paginatedReturn;
  },
}));

// The single-shot hook — only used by the non-paginated regression test.
let singleReturn: { data: unknown; isLoading: boolean; blocked: boolean };
vi.mock('../../hooks/use-bound-query', () => ({
  useBoundQuery: () => singleReturn,
}));

const loadMore = vi.fn();

function paginated(
  over: Partial<BoundPaginatedQueryResult>,
): BoundPaginatedQueryResult {
  return {
    results: [],
    status: 'CanLoadMore',
    isLoading: false,
    loadMore,
    blocked: false,
    needsConfig: false,
    ...over,
  };
}

const QUERY = { path: 'tasks/queries:listTasksByProjectPaginated', args: {} };
const COLUMNS = ['title', 'status'];

function taskRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `t_${i}`,
    title: `Task ${i}`,
    status: 'todo',
  }));
}

afterEach(() => {
  loadMore.mockClear();
  lastPaginatedArgs = undefined;
});

describe('Collection — paginated', () => {
  it('renders more than the default 50-row cap (no silent truncation)', () => {
    paginatedReturn = paginated({
      results: taskRows(60),
      status: 'Exhausted',
    });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    // 60 data rows + 1 header row — the old 50-cap would have shown 51.
    expect(screen.getAllByRole('row')).toHaveLength(61);
  });

  it('shows "Load more" while more pages exist and loads the next page on click', async () => {
    paginatedReturn = paginated({
      results: taskRows(1),
      status: 'CanLoadMore',
    });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    const button = screen.getByRole('button', { name: 'apps.list.loadMore' });
    await userEvent.click(button);
    expect(loadMore).toHaveBeenCalledWith(50);
  });

  it('disables the button and shows the loading label while fetching more', () => {
    paginatedReturn = paginated({
      results: taskRows(1),
      status: 'LoadingMore',
    });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(
      screen.getByRole('button', { name: 'apps.list.loadingMore' }),
    ).toBeDisabled();
  });

  it('shows the empty state (no button) when exhausted with no rows', () => {
    paginatedReturn = paginated({ results: [], status: 'Exhausted' });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(screen.getByText('apps.binding.empty')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'apps.list.loadMore' }),
    ).not.toBeInTheDocument();
  });

  it('shows a skeleton on first-page load (not a premature empty state)', () => {
    paginatedReturn = paginated({ results: [], status: 'LoadingFirstPage' });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(screen.queryByText('apps.binding.empty')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'apps.list.loadMore' }),
    ).not.toBeInTheDocument();
  });

  it('surfaces the blocked state when the path is not allowlisted', () => {
    paginatedReturn = paginated({ blocked: true });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(screen.getByText('apps.binding.blocked')).toBeInTheDocument();
  });

  it('prompts to configure when a binding is unresolved', () => {
    paginatedReturn = paginated({ needsConfig: true });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(screen.getByText('apps.list.needsConfig')).toBeInTheDocument();
  });
});

describe('Collection — non-paginated (regression)', () => {
  it('uses the single-shot path and shows no "Load more" when perPage is unset', () => {
    singleReturn = {
      data: { tasks: taskRows(1) },
      isLoading: false,
      blocked: false,
    };

    render(<Collection query={QUERY} columns={COLUMNS} />);

    expect(screen.getByText('Task 0')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'apps.list.loadMore' }),
    ).not.toBeInTheDocument();
  });
});

describe('Collection — status filter (config-driven)', () => {
  const STATUS_FILTER = [
    { field: 'status', values: ['todo', 'in_progress', 'done'] },
  ];

  it('merges the selected value into the bound query args, and clears on All', async () => {
    paginatedReturn = paginated({
      results: taskRows(1),
      status: 'CanLoadMore',
    });

    render(
      <Collection
        query={{ path: QUERY.path, args: { projectId: 'p1' } }}
        columns={COLUMNS}
        perPage={50}
        filters={STATUS_FILTER}
      />,
    );

    // No selection yet → args carry only the base projectId.
    expect(lastPaginatedArgs).toEqual({ projectId: 'p1' });

    await userEvent.click(
      screen.getByRole('button', { name: 'opt:in_progress' }),
    );
    expect(lastPaginatedArgs).toEqual({
      projectId: 'p1',
      status: 'in_progress',
    });

    // Selecting "All" removes the field again.
    await userEvent.click(screen.getByRole('button', { name: 'opt:__all__' }));
    expect(lastPaginatedArgs).toEqual({ projectId: 'p1' });
  });

  it('renders an All option (no status name hardcoded in the component)', () => {
    paginatedReturn = paginated({ results: taskRows(1), status: 'Exhausted' });

    render(
      <Collection
        query={QUERY}
        columns={COLUMNS}
        perPage={50}
        filters={STATUS_FILTER}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'opt:__all__' }),
    ).toBeInTheDocument();
  });
});
