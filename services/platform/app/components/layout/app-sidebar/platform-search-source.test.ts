import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  /** Reads whose search the retry policy gave up on, by contract name. */
  failing: new Set<string>(),
  /** Of those, the reads being asked again. */
  retrying: new Set<string>(),
  refetch: vi.fn((_name: string) => Promise.resolve()),
  chat: 'ready' as 'ready' | 'unavailable',
  chatHits: [] as unknown[],
  retryChatSearch: vi.fn((_query: string) => Promise.resolve()),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => {
    const refetch = () => backend.refetch(name);
    if (args !== 'skip' && backend.failing.has(name)) {
      // react-query restarts a never-answered read from `pending`.
      const retrying = backend.retrying.has(name);
      return {
        data: undefined,
        isLoading: retrying,
        isFetching: retrying,
        isError: !retrying,
        errorUpdateCount: 1,
        error: retrying ? null : new Error('unreachable'),
        refetch,
      };
    }
    return {
      data:
        name === 'projects/search:searchProjects'
          ? [
              {
                projectId: 'p1',
                name: 'Old project',
                snippet: '',
                archived: true,
              },
            ]
          : name === 'tasks/search:searchTasks'
            ? [
                {
                  taskId: 't1',
                  projectId: 'p1',
                  title: 'Old task',
                  snippet: '',
                  archived: true,
                },
                {
                  taskId: 't2',
                  projectId: 'p1',
                  title: 'Active task',
                  snippet: '',
                  projectArchived: true,
                },
              ]
            : [],
      isLoading: false,
      isFetching: false,
      isError: false,
      errorUpdateCount: 0,
      error: null,
      refetch,
    };
  },
}));

vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useChatQuery: (_name: string, args: unknown) =>
    args === 'skip'
      ? { status: 'loading' }
      : backend.chat === 'unavailable'
        ? { status: 'unavailable' }
        : { status: 'ready', data: backend.chatHits },
  useChatSearchRetry: () => backend.retryChatSearch,
}));
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { createPlatformSearchSource } from './platform-search-source';

const OPEN = { active: true, open: true };
const BACKEND_SEARCHES = [
  'projects/search:searchProjects',
  'tasks/search:searchTasks',
  'documents/search:searchDocuments',
  'contacts/search:searchContacts',
];

beforeEach(() => {
  backend.failing.clear();
  backend.retrying.clear();
  backend.refetch.mockClear();
  backend.chat = 'ready';
  backend.chatHits = [];
  backend.retryChatSearch.mockClear();
});

describe('combined search status badges', () => {
  it('preserves the archived project and task badges from the source results', () => {
    const source = createPlatformSearchSource({ organizationId: 'o1' });
    const { result } = renderHook(() => source('task', OPEN));
    expect(
      result.current.results.map(({ id, badge }) => ({ id, badge })),
    ).toEqual([
      { id: 'p1', badge: 'search.badgeArchived' },
      { id: 't1', badge: 'search.badgeArchived' },
      { id: 't2', badge: 'search.badgeProjectArchived' },
    ]);
  });
});

// #4890: a failed search read as `ready` with no rows, so the palette said
// "No results" and a chat or project that exists looked missing.
describe('a combined search that fails', () => {
  it('reports the error, not "no results", when every source fails', () => {
    for (const name of BACKEND_SEARCHES) backend.failing.add(name);
    backend.chat = 'unavailable';
    const source = createPlatformSearchSource({ organizationId: 'o1' });
    const { result } = renderHook(() => source('task', OPEN));

    expect(result.current).toMatchObject({
      status: 'error',
      results: [],
      retrying: false,
    });
    expect(result.current.partialFailure).toBeUndefined();
    expect(result.current.retry).toBeInstanceOf(Function);
  });

  it('keeps what loaded and says the rest failed when only the chat search fails', () => {
    backend.chat = 'unavailable';
    const source = createPlatformSearchSource({ organizationId: 'o1' });
    const { result } = renderHook(() => source('task', OPEN));

    expect(result.current).toMatchObject({
      status: 'ready',
      partialFailure: true,
    });
    expect(result.current.results.map(({ id }) => id)).toEqual([
      'p1',
      't1',
      't2',
    ]);
    result.current.retry?.();
    expect(backend.retryChatSearch).toHaveBeenCalledWith('task');
    expect(backend.refetch).not.toHaveBeenCalled();
  });

  it('keeps the chat rows when the other searches fail', () => {
    for (const name of BACKEND_SEARCHES) backend.failing.add(name);
    backend.chatHits = [
      { threadId: 'c1', title: 'Task chat', snippet: 'task', updatedAt: 1 },
    ];
    const source = createPlatformSearchSource({ organizationId: 'o1' });
    const { result } = renderHook(() => source('task', OPEN));

    expect(result.current).toMatchObject({
      status: 'ready',
      partialFailure: true,
    });
    expect(result.current.results.map(({ id }) => id)).toEqual(['c1']);
  });

  it('reports the error in the Chats scope when the chat search fails', () => {
    backend.chat = 'unavailable';
    const source = createPlatformSearchSource({
      organizationId: 'o1',
      scope: 'chats',
    });
    const { result } = renderHook(() => source('task', OPEN));

    expect(result.current).toMatchObject({ status: 'error', results: [] });
  });

  it('counts only the sources the search asks toward "every source failed"', () => {
    backend.failing.add('tasks/search:searchTasks');
    backend.chat = 'unavailable';
    const source = createPlatformSearchSource({
      organizationId: 'o1',
      include: { projects: false, documents: false, contacts: false },
    });
    const { result } = renderHook(() => source('task', OPEN));

    expect(result.current.status).toBe('error');
  });

  it('asks again only what failed, and not what is already being asked', () => {
    backend.failing.add('projects/search:searchProjects');
    backend.failing.add('documents/search:searchDocuments');
    backend.retrying.add('documents/search:searchDocuments');
    const source = createPlatformSearchSource({ organizationId: 'o1' });
    const { result } = renderHook(() => source('task', OPEN));

    expect(result.current).toMatchObject({
      partialFailure: true,
      retrying: true,
    });
    result.current.retry?.();
    expect(backend.refetch).toHaveBeenCalledTimes(1);
    expect(backend.refetch).toHaveBeenCalledWith(
      'projects/search:searchProjects',
    );
    expect(backend.retryChatSearch).not.toHaveBeenCalled();
  });

  it('holds the error while every failed search is asked again', () => {
    for (const name of BACKEND_SEARCHES) {
      backend.failing.add(name);
      backend.retrying.add(name);
    }
    backend.chat = 'unavailable';
    const source = createPlatformSearchSource({ organizationId: 'o1' });
    const { result } = renderHook(() => source('task', OPEN));

    expect(result.current).toMatchObject({
      status: 'error',
      retrying: true,
    });
  });
});
