// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import {
  useProjectDependencies,
  useTask,
  useTaskActivity,
  useTaskAgentRuns,
  useTaskDiscussion,
  useTaskOpsIndicators,
  useTaskOpsIndicatorsAcrossProjects,
} from './queries';

const mocks = vi.hoisted(() => ({
  paginatedRead: vi.fn(),
  loadMore: vi.fn(),
  result: {
    data: undefined as unknown,
    isLoading: true,
    error: null as unknown,
  },
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => mocks.result,
}));
vi.mock('@/app/hooks/use-cached-paginated-query', () => ({
  useCachedPaginatedQuery: (...args: unknown[]) => {
    mocks.paginatedRead(...args);
    return {
      results: [],
      status: 'CanLoadMore',
      loadMore: mocks.loadMore,
    };
  },
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

beforeEach(() => {
  mocks.paginatedRead.mockClear();
  mocks.loadMore.mockClear();
  mocks.result = { data: undefined, isLoading: true, error: null };
});

describe('task history read defaults', () => {
  it('keeps empty histories stable while they load', () => {
    const activity = renderHook(() => useTaskActivity('task-1'));
    const runs = renderHook(() => useTaskAgentRuns('task-1'));
    const firstActivity = activity.result.current.activity;
    const firstRuns = runs.result.current.runs;
    activity.rerender();
    runs.rerender();

    expect(activity.result.current.activity).toBe(firstActivity);
    expect(runs.result.current.runs).toBe(firstRuns);
  });

  it('opens a bounded latest page and keeps earlier comments reachable', () => {
    const { result } = renderHook(() => useTaskDiscussion('task-1'));
    expect(mocks.paginatedRead).toHaveBeenCalledWith(
      'tasks/queries:listTaskDiscussion',
      { taskId: 'task-1', organizationId: 'org-1' },
      { initialNumItems: 30 },
    );
    expect(result.current.hasEarlier).toBe(true);
    result.current.loadEarlier();
    expect(mocks.loadMore).toHaveBeenCalledWith(30);
  });
});

// A deep link to a deleted or foreign task used to resolve to `task: null`
// with nothing telling the sheet WHY — it rendered an empty dialog. The hook
// now names the settled "gone" state apart from loading and other failures.
describe('useTask', () => {
  it('is loading, not notFound, while the read is in flight', () => {
    const { result } = renderHook(() => useTask('task-1'));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.notFound).toBe(false);
    expect(result.current.task).toBeNull();
  });

  it('reports notFound when the adapter answers null (404)', () => {
    mocks.result = { data: null, isLoading: false, error: null };
    const { result } = renderHook(() => useTask('task-1'));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it.each(['TASK_NOT_FOUND', 'TASK_FORBIDDEN'])(
    'reports notFound on a %s refusal, without surfacing it as an error',
    (code) => {
      mocks.result = {
        data: undefined,
        isLoading: false,
        error: new AppError({ code, message: 'refused' }),
      };
      const { result } = renderHook(() => useTask('task-1'));
      expect(result.current.notFound).toBe(true);
      expect(result.current.error).toBeNull();
    },
  );

  it('surfaces any other failure as error, not notFound', () => {
    const error = new AppError({ code: 'INTERNAL', message: 'boom' });
    mocks.result = { data: undefined, isLoading: false, error };
    const { result } = renderHook(() => useTask('task-1'));
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBe(error);
  });

  it('answers the task when the read succeeds', () => {
    mocks.result = {
      data: {
        task: { _id: 'task-1', title: 'Ship it' },
        canEdit: true,
        canComment: true,
      },
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useTask('task-1'));
    expect(result.current.task).toEqual({ _id: 'task-1', title: 'Ship it' });
    expect(result.current.notFound).toBe(false);
    expect(result.current.canEdit).toBe(true);
  });
});

/** A read its retry policy gave up on, as react-query settles it. */
function failedRead(error: unknown, refetch = vi.fn()) {
  return {
    data: undefined,
    isLoading: false,
    error,
    isError: true,
    isFetching: false,
    errorUpdateCount: 1,
    refetch,
  };
}

/** The same read once a retry starts: react-query sets a read that never
 *  answered back to pending, its error cleared. Offline, the browser holds
 *  the request back and the read is not even fetching. */
function retriedRead({ offline = false } = {}) {
  return {
    data: undefined,
    isLoading: !offline,
    error: null,
    isError: false,
    isFetching: !offline,
    errorUpdateCount: 1,
    refetch: vi.fn(),
  };
}

/** The read answered at last, after the failures before it. */
function answeredRead(data: unknown) {
  return { ...retriedRead(), data, isLoading: false, isFetching: false };
}

// #4587: Try again on a failed task read must not trade the failure for a
// skeleton (or "not found") while the retry runs, then bring it back.
describe('useTask through a retry', () => {
  it('holds a failed read until an answer replaces it', () => {
    const error = new TypeError('Failed to fetch');
    mocks.result = failedRead(error);
    const { result, rerender } = renderHook(() => useTask('task-1'));
    expect(result.current.error).toBe(error);
    expect(result.current.retrying).toBe(false);

    mocks.result = retriedRead();
    rerender();
    expect(result.current.error).toBe(error);
    expect(result.current.notFound).toBe(false);
    expect(result.current.retrying).toBe(true);

    mocks.result = retriedRead({ offline: true });
    rerender();
    expect(result.current.error).toBe(error);
    expect(result.current.retrying).toBe(false);

    mocks.result = answeredRead({ task: { _id: 'task-1', title: 'Ship it' } });
    rerender();
    expect(result.current.task).toEqual({ _id: 'task-1', title: 'Ship it' });
    expect(result.current.error).toBeNull();
    expect(result.current.retrying).toBe(false);
  });

  it('keeps a task that is not yours to see not found while it is read again', () => {
    mocks.result = failedRead(
      new AppError({ code: 'TASK_FORBIDDEN', message: 'refused' }),
    );
    const { result, rerender } = renderHook(() => useTask('task-1'));
    expect(result.current.notFound).toBe(true);

    mocks.result = retriedRead();
    rerender();
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("never holds one task's failure for another", () => {
    mocks.result = failedRead(new TypeError('Failed to fetch'));
    const { result, rerender } = renderHook(({ id }) => useTask(id), {
      initialProps: { id: 'task-1' },
    });
    expect(result.current.error).not.toBeNull();

    // The next task's own read is being retried: it has no failure of its
    // own on hand yet, and the last task's is not it.
    mocks.result = retriedRead();
    rerender({ id: 'task-2' });
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it('reads the task again on retry', () => {
    const refetch = vi.fn(() => Promise.resolve());
    mocks.result = failedRead(new TypeError('Failed to fetch'), refetch);
    const { result } = renderHook(() => useTask('task-1'));
    result.current.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// The board's context is rebuilt whenever one of these arrays changes, and
// every card reads the context: a fresh `[]` per render while a read is
// pending or failed re-rendered the whole board on each open of a task
// (#3939).
describe('board read defaults', () => {
  it.each([
    ['pending', { data: undefined, isLoading: true, error: null }],
    [
      'failed',
      {
        data: undefined,
        isLoading: false,
        error: new AppError({ code: 'INTERNAL', message: 'boom' }),
        status: 'error',
      },
    ],
  ])('keep one empty array per field while a read is %s', (_state, read) => {
    mocks.result = read;
    const ops = renderHook(() => useTaskOpsIndicators('project-1'));
    const across = renderHook(() => useTaskOpsIndicatorsAcrossProjects());
    const deps = renderHook(() => useProjectDependencies('project-1'));
    const first = {
      running: ops.result.current.runningTaskIds,
      asking: ops.result.current.askingTaskIds,
      reviews: ops.result.current.pendingReviews,
      runs: ops.result.current.runs,
      waits: ops.result.current.automationWaits,
      acrossRunning: across.result.current.runningTaskIds,
      acrossReviews: across.result.current.pendingReviews,
      edges: deps.result.current.edges,
    };
    ops.rerender();
    across.rerender();
    deps.rerender();
    expect(first.running).toHaveLength(0);
    expect(ops.result.current.runningTaskIds).toBe(first.running);
    expect(ops.result.current.askingTaskIds).toBe(first.asking);
    expect(ops.result.current.pendingReviews).toBe(first.reviews);
    expect(ops.result.current.runs).toBe(first.runs);
    expect(ops.result.current.automationWaits).toBe(first.waits);
    expect(across.result.current.runningTaskIds).toBe(first.acrossRunning);
    expect(across.result.current.pendingReviews).toBe(first.acrossReviews);
    expect(deps.result.current.edges).toBe(first.edges);
  });
});
