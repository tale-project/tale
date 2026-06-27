// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundPaginatedQueryResult } from '../../hooks/use-bound-paginated-query';
import { Collection } from './collection';

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
vi.mock('./subject-capacity-chip', () => ({
  SubjectCapacityChip: () => null,
}));

// The paginated data hook — drive it by hand per test. Keep the REAL DataTable
// so the maxRows / no-truncation assertion is meaningful.
let paginatedReturn: BoundPaginatedQueryResult;
vi.mock('../../hooks/use-bound-paginated-query', () => ({
  useBoundPaginatedQuery: () => paginatedReturn,
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
