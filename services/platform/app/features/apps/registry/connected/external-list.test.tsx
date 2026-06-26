// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundActionInfiniteQueryResult } from '../../hooks/use-bound-action-infinite-query';
import { ExternalList } from './external-list';

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

vi.mock('@/app/hooks/use-action-query', () => ({
  convexErrorCode: () => undefined,
  isStructuredConvexError: () => false,
}));

// The reactive cross-reference query (tasks already created). Per-test value.
let refRows: unknown[] = [];
vi.mock('../../hooks/use-bound-query', () => ({
  useBoundQuery: () => ({ data: refRows, isLoading: false, error: null }),
}));

// The paginated data hook — keep the real `parsePage`, drive the hook by hand.
let hookReturn: BoundActionInfiniteQueryResult;
vi.mock(
  '../../hooks/use-bound-action-infinite-query',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../hooks/use-bound-action-infinite-query')
      >();
    return { ...actual, useBoundActionInfiniteQuery: () => hookReturn };
  },
);

const fetchNextPage = vi.fn();

function hook(
  over: Partial<BoundActionInfiniteQueryResult>,
): BoundActionInfiniteQueryResult {
  return {
    pages: [],
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    fetchNextPage,
    refetch: vi.fn(),
    blocked: false,
    needsConfig: false,
    ...over,
  };
}

/** One GitHub-issues page in the action's `{ data, pagination }` envelope. */
function page(numbers: number[], hasNextPage: boolean) {
  return {
    data: numbers.map((n) => ({ number: n, title: `Issue ${n}` })),
    pagination: { hasNextPage },
  };
}

const PROPS = {
  source: { path: 'integrations/public_actions:listGitHubIssues' },
  itemsKey: 'data',
  columns: ['number', 'title'],
  perPage: 3,
  excludeBy: {
    query: { path: 'tasks/queries:listTasksByProject' },
    refField: 'externalId',
    rowKeyTemplate: 'o/r#{number}',
  },
};

afterEach(() => {
  refRows = [];
  fetchNextPage.mockClear();
});

describe('ExternalList — filter-aware pagination', () => {
  it('auto-fetches the next page when the loaded page filters to empty', () => {
    // Page 1's three issues are all already tasks → visibleRows empty, but more
    // pages exist and we are under the cap, so the block pulls the next page.
    refRows = [
      { externalId: 'o/r#1' },
      { externalId: 'o/r#2' },
      { externalId: 'o/r#3' },
    ];
    hookReturn = hook({ pages: [page([1, 2, 3], true)], hasNextPage: true });

    render(<ExternalList {...PROPS} />);

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    // It must NOT dead-end on an empty state while still searching.
    expect(screen.queryByText('apps.binding.empty')).not.toBeInTheDocument();
  });

  it('renders only the non-excluded rows once matches are loaded', () => {
    refRows = [{ externalId: 'o/r#1' }]; // issue 1 already a task
    hookReturn = hook({ pages: [page([1, 2, 3], false)], hasNextPage: false });

    render(<ExternalList {...PROPS} />);

    expect(screen.queryByText('Issue 1')).not.toBeInTheDocument();
    expect(screen.getByText('Issue 2')).toBeInTheDocument();
    expect(screen.getByText('Issue 3')).toBeInTheDocument();
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('shows the empty state when all rows are excluded and the source is exhausted', () => {
    // Every loaded row is already a task and the cursor reports no more pages:
    // termination is the cursor (hasNextPage false), so the block stops and shows
    // the empty state instead of spinning — no fixed page-count cap involved.
    refRows = [1, 2, 3].map((n) => ({ externalId: `o/r#${n}` }));
    hookReturn = hook({ pages: [page([1, 2, 3], false)], hasNextPage: false });

    render(<ExternalList {...PROPS} />);

    expect(fetchNextPage).not.toHaveBeenCalled();
    expect(screen.getByText('apps.binding.empty')).toBeInTheDocument();
  });

  it('renders more than the default 50-row cap (no silent truncation)', () => {
    const numbers = Array.from({ length: 60 }, (_, i) => i + 1);
    hookReturn = hook({ pages: [page(numbers, false)], hasNextPage: false });

    render(<ExternalList {...PROPS} excludeBy={undefined} />);

    // 60 data rows + 1 header row.
    expect(screen.getAllByRole('row')).toHaveLength(61);
  });

  it('keeps the loaded rows visible AND surfaces an inline error when a later page fetch fails', () => {
    // A failed "Load more" populates `error` but the earlier pages remain — the
    // list must stay on screen (not be replaced by the full error state) while
    // still telling the user the load didn't take, so the click isn't silent.
    hookReturn = hook({
      pages: [page([1, 2, 3], true)],
      hasNextPage: true,
      error: new Error('rate limited'),
    });

    render(<ExternalList {...PROPS} excludeBy={undefined} />);

    expect(screen.getByText('Issue 1')).toBeInTheDocument();
    expect(screen.getByText(/apps\.list\.error/)).toBeInTheDocument();
    // The retry affordance stays available.
    expect(
      screen.getByRole('button', { name: 'apps.list.loadMore' }),
    ).toBeInTheDocument();
  });

  it('stops auto-fetching when a next-page fetch errors and surfaces the error (no infinite loop / stuck skeleton)', () => {
    // Page 1 filters to empty, more pages exist, under the cap — but the
    // auto-triggered next-page fetch FAILED. The block must not re-fire
    // fetchNextPage (which would loop, hammering upstream), must drop the
    // skeleton, and must show the error rather than a permanent loading state.
    refRows = [
      { externalId: 'o/r#1' },
      { externalId: 'o/r#2' },
      { externalId: 'o/r#3' },
    ];
    hookReturn = hook({
      pages: [page([1, 2, 3], true)],
      hasNextPage: true,
      error: new Error('rate limited'),
    });

    render(<ExternalList {...PROPS} />);

    expect(fetchNextPage).not.toHaveBeenCalled();
    expect(screen.getByText(/apps\.list\.error/)).toBeInTheDocument();
  });

  it('shows the error (not a calm "empty") when all loaded rows filter out and the fetch errored', () => {
    // Every loaded row is excluded → visibleRows empty. A hard error must win
    // over the calm empty state, which is keyed on visibleRows, not raw rows.
    refRows = [{ externalId: 'o/r#1' }, { externalId: 'o/r#2' }];
    hookReturn = hook({
      pages: [page([1, 2], false)],
      hasNextPage: false,
      error: new Error('server exploded'),
    });

    render(<ExternalList {...PROPS} />);

    expect(screen.getByText(/apps\.list\.error/)).toBeInTheDocument();
    expect(screen.queryByText('apps.binding.empty')).not.toBeInTheDocument();
  });

  it('shows "Load more" while there are matches and more pages, and fetches on click', async () => {
    hookReturn = hook({ pages: [page([1, 2, 3], true)], hasNextPage: true });

    render(<ExternalList {...PROPS} excludeBy={undefined} />);

    const button = screen.getByRole('button', { name: 'apps.list.loadMore' });
    await userEvent.click(button);
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
