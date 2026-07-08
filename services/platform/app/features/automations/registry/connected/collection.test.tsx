// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundPaginatedQueryResult } from '../../hooks/use-bound-paginated-query';
import { Collection } from './collection';

// Stand in for the Radix dropdown (portals/pointer-events are flaky in jsdom):
// render the trigger plus one button per radio option that fires onValueChange,
// so the filter merge can be driven directly. The option's display label rides
// along as `title` (the text stays the raw value so existing queries hold).
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
              title={typeof o.label === 'string' ? o.label : undefined}
              onClick={() => radio.onValueChange(o.value)}
            >
              {`opt:${o.value}`}
            </button>
          ))}
      </div>
    );
  },
}));

// i18n → echo `<ns>.<key>`, interpolating params, so assertions read clearly.
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

// The effect applier — captured so onRowClick / addAction effects can be
// asserted without a router or resource-detail provider.
const applyEffect = vi.fn();
vi.mock('../../runtime/action-effects', () => ({
  useActionEffect: () => applyEffect,
}));

// The bound dispatcher behind `addAction` — driven by hand per test.
const dispatch = vi.fn();
vi.mock('../../hooks/use-bound-action', () => ({
  useBoundAction: () => ({ dispatch, isPending: false }),
}));

// The rich DataTable reads the org id from route params — no router here.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
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
// + useListPage so the buffering / no-truncation assertions are meaningful.
// Capture the args it receives so the filter-merge can be asserted.
let paginatedReturn: BoundPaginatedQueryResult;
let lastPaginatedArgs: unknown;
vi.mock('../../hooks/use-bound-paginated-query', () => ({
  useBoundPaginatedQuery: (_path: string, args: unknown) => {
    lastPaginatedArgs = args;
    return paginatedReturn;
  },
}));

// The single-shot hook — only used by the non-paginated tests.
let singleReturn: {
  data: unknown;
  isLoading: boolean;
  blocked: boolean;
  needsConfig: boolean;
};
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
const LOAD_MORE = 'common.pagination.loadMore';

function taskRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `t_${i}`,
    title: `Task ${i}`,
    status: 'todo',
  }));
}

afterEach(() => {
  loadMore.mockClear();
  applyEffect.mockClear();
  dispatch.mockReset();
  lastPaginatedArgs = undefined;
});

describe('Collection — paginated', () => {
  it('reveals every accumulated row behind "Load more" (no silent truncation)', async () => {
    paginatedReturn = paginated({
      results: taskRows(60),
      status: 'Exhausted',
    });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    // First page-size worth of rows + 1 header row, with an explicit
    // affordance to reach the rest — never a silent cap.
    expect(screen.getAllByRole('row')).toHaveLength(51);
    await userEvent.click(screen.getByRole('button', { name: LOAD_MORE }));
    expect(screen.getAllByRole('row')).toHaveLength(61);
  });

  it('shows "Load more" while more pages exist and pulls the next page on click', async () => {
    paginatedReturn = paginated({
      results: taskRows(1),
      status: 'CanLoadMore',
    });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    const button = screen.getByRole('button', { name: LOAD_MORE });
    await userEvent.click(button);
    // useListPage prefetches ahead of the display buffer (3 pages).
    expect(loadMore).toHaveBeenCalledWith(150);
  });

  it('shows the loading indicator instead of the button while fetching more', () => {
    paginatedReturn = paginated({
      results: taskRows(1),
      status: 'LoadingMore',
    });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(
      screen.queryByRole('button', { name: LOAD_MORE }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText('common.pagination.loading').length,
    ).toBeGreaterThan(0);
  });

  it('shows the empty state (no button) when exhausted with no rows', () => {
    paginatedReturn = paginated({ results: [], status: 'Exhausted' });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(screen.getByText('automations.binding.empty')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: LOAD_MORE }),
    ).not.toBeInTheDocument();
  });

  it('shows a skeleton on first-page load (not a premature empty state)', () => {
    paginatedReturn = paginated({
      results: [],
      status: 'LoadingFirstPage',
      isLoading: true,
    });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(
      screen.queryByText('automations.binding.empty'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: LOAD_MORE }),
    ).not.toBeInTheDocument();
  });

  it('surfaces the blocked state when the path is not allowlisted', () => {
    paginatedReturn = paginated({ blocked: true });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(screen.getByText('automations.binding.blocked')).toBeInTheDocument();
  });

  it('prompts to configure when a binding is unresolved', () => {
    paginatedReturn = paginated({ needsConfig: true });

    render(<Collection query={QUERY} columns={COLUMNS} perPage={50} />);

    expect(
      screen.getByText('automations.list.needsConfig'),
    ).toBeInTheDocument();
  });

  it('reads an unresolved $state. binding as "awaiting selection", not config', () => {
    paginatedReturn = paginated({ needsConfig: true });

    render(
      <Collection
        query={{ path: QUERY.path, args: { taskId: '$state.selectedTask' } }}
        columns={COLUMNS}
        perPage={50}
      />,
    );

    expect(
      screen.getByText('automations.binding.awaitingSelection'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('automations.list.needsConfig'),
    ).not.toBeInTheDocument();
  });
});

describe('Collection — non-paginated (regression)', () => {
  it('uses the single-shot path and shows no "Load more" when perPage is unset', () => {
    singleReturn = {
      data: { tasks: taskRows(1) },
      isLoading: false,
      blocked: false,
      needsConfig: false,
    };

    render(<Collection query={QUERY} columns={COLUMNS} />);

    expect(screen.getByText('Task 0')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: LOAD_MORE }),
    ).not.toBeInTheDocument();
    // A small one-shot list carries no pagination footer at all.
    expect(
      screen.queryByText('common.pagination.noMore'),
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

  it('resolves valueLabels for arg-filter options and the selected trigger value', async () => {
    paginatedReturn = paginated({ results: taskRows(1), status: 'Exhausted' });

    render(
      <Collection
        query={QUERY}
        columns={COLUMNS}
        perPage={50}
        filters={[
          {
            field: 'status',
            values: ['todo', 'in_progress'],
            valueLabels: { in_progress: 'Working' },
          },
        ]}
      />,
    );

    // Mapped option shows its literal label; unmapped stays the raw value.
    expect(
      screen.getByRole('button', { name: 'opt:in_progress' }),
    ).toHaveAttribute('title', 'Working');
    expect(screen.getByRole('button', { name: 'opt:todo' })).toHaveAttribute(
      'title',
      'todo',
    );

    // The trigger reflects the mapped label once selected — the raw value
    // still travels as the query arg.
    await userEvent.click(
      screen.getByRole('button', { name: 'opt:in_progress' }),
    );
    expect(screen.getByText('Working')).toBeInTheDocument();
    expect(lastPaginatedArgs).toEqual({ status: 'in_progress' });
  });

  it("resolves valueLabels for mode 'client' facet options", async () => {
    paginatedReturn = paginated({ results: taskRows(2), status: 'Exhausted' });

    render(
      <Collection
        query={QUERY}
        columns={COLUMNS}
        perPage={50}
        filters={[
          {
            field: 'status',
            values: ['todo', 'done'],
            mode: 'client',
            valueLabels: { todo: 'To do' },
          },
        ]}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'common.labels.filter' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /status/i }));
    expect(screen.getByText('To do')).toBeInTheDocument();
    // Unmapped facet value renders raw.
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it("keeps mode 'client' filters out of the query args and in the table filter bar", () => {
    paginatedReturn = paginated({ results: taskRows(2), status: 'Exhausted' });

    render(
      <Collection
        query={{ path: QUERY.path, args: { projectId: 'p1' } }}
        columns={COLUMNS}
        perPage={50}
        filters={[
          { field: 'status', values: ['todo', 'done'], mode: 'client' },
        ]}
      />,
    );

    // Client filters never touch the bound query's args…
    expect(lastPaginatedArgs).toEqual({ projectId: 'p1' });
    // …and surface as the DataTable's faceted filter affordance instead.
    expect(
      screen.getByRole('button', { name: 'common.labels.filter' }),
    ).toBeInTheDocument();
    // No arg-mode dropdown was rendered for it.
    expect(screen.queryByText('opt:__all__')).not.toBeInTheDocument();
  });
});

describe('Collection — search, row click, add action', () => {
  it('narrows rows via the managed search box', async () => {
    paginatedReturn = paginated({ results: taskRows(3), status: 'Exhausted' });

    render(
      <Collection
        query={QUERY}
        columns={COLUMNS}
        perPage={50}
        search={{ fields: ['title'] }}
      />,
    );

    expect(screen.getByText('Task 0')).toBeInTheDocument();
    await userEvent.type(
      screen.getByPlaceholderText('common.search.placeholder'),
      'Task 1',
    );
    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.queryByText('Task 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Task 2')).not.toBeInTheDocument();
  });

  it('applies the onRowClick effect with the clicked row as $selected', async () => {
    paginatedReturn = paginated({ results: taskRows(1), status: 'Exhausted' });
    const effect = {
      kind: 'openDetail' as const,
      subjectType: 'task',
      id: '$selected._id',
    };

    render(
      <Collection
        query={QUERY}
        columns={COLUMNS}
        perPage={50}
        onRowClick={effect}
      />,
    );

    await userEvent.click(screen.getByText('Task 0'));
    expect(applyEffect).toHaveBeenCalledWith(effect, undefined, {
      _id: 't_0',
      title: 'Task 0',
      status: 'todo',
    });
  });

  it('renders addAction in the header, dispatches it, and applies onSuccess', async () => {
    paginatedReturn = paginated({ results: taskRows(1), status: 'Exhausted' });
    dispatch.mockResolvedValue({ taskId: 't9' });
    const onSuccess = { kind: 'toast' as const, titleKey: 'created' };

    render(
      <Collection
        query={QUERY}
        columns={COLUMNS}
        perPage={50}
        addAction={{
          label: 'New item',
          path: 'tasks/mutations:createTask',
          mode: 'mutation',
          args: { projectId: 'p1' },
          onSuccess,
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'New item' }));
    expect(dispatch).toHaveBeenCalledWith({ projectId: 'p1' });
    await waitFor(() =>
      expect(applyEffect).toHaveBeenCalledWith(onSuccess, { taskId: 't9' }),
    );
  });
});
