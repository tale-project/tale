// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { useTask } from './queries';

const mocks = vi.hoisted(() => ({
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
  useCachedPaginatedQuery: () => ({ results: [], status: 'Exhausted' }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

beforeEach(() => {
  mocks.result = { data: undefined, isLoading: true, error: null };
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
