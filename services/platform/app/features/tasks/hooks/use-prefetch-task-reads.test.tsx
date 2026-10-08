import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePrefetchTaskReads, useTaskDiscussion } from './queries';

// A task's discussion, dependencies, reviewer and watch state are read by
// sections that mount only once the task has arrived and rendered: they
// waited a round trip and a render behind it. They start with the task now,
// under the keys those sections read.

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

let requested: string[];
let discussionPageSizes: Array<string | null>;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/tasks');
  requested = [];
  discussionPageSizes = [];
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      'http://localhost',
    );
    requested.push(url.pathname);
    if (url.pathname.endsWith('/comments')) {
      discussionPageSizes.push(url.searchParams.get('numItems'));
      return Promise.resolve(
        json({
          page: [
            {
              messageId: 'm1',
              authorType: 'user',
              authorId: 'u1',
              body: 'First',
              createdAt: 1,
              editedAt: null,
              mentions: null,
              bodyByLocale: null,
            },
          ],
          isDone: true,
          continueCursor: '',
        }),
      );
    }
    return Promise.resolve(json({}));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePrefetchTaskReads', () => {
  it('starts the discussion, dependencies, reviewer and watch reads with the task', async () => {
    // The app's freshness window (router.tsx): a read fetched a moment ago
    // is not fetched again when a section mounts.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    renderHook(() => usePrefetchTaskReads('task-1'), { wrapper });

    await waitFor(() =>
      expect(requested).toEqual(
        expect.arrayContaining([
          '/api/app/tasks/task-1/comments',
          '/api/app/tasks/task-1/dependencies',
          '/api/app/tasks/task-1/reviewer',
          '/api/app/collab/tasks/task-1/subscription',
        ]),
      ),
    );
    expect(discussionPageSizes).toEqual(['30']);

    // The discussion the section reads is the one already fetched.
    const reads = requested.length;
    const { result } = renderHook(() => useTaskDiscussion('task-1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.comments).toHaveLength(1));
    expect(requested).toHaveLength(reads);
  });

  it('does nothing without a cache in scope', () => {
    expect(() =>
      renderHook(() => usePrefetchTaskReads('task-1')),
    ).not.toThrow();
    expect(requested).toEqual([]);
  });
});
