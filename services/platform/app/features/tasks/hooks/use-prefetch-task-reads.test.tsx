import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  usePrefetchTaskReads,
  useTaskActivity,
  useTaskAgentRuns,
  useTaskDiscussion,
} from './queries';

// A task's discussion, dependencies, reviewer and watch state are read by
// sections that mount only once the task has arrived and rendered: they
// waited a round trip and a render behind it. They start with the task now,
// under the keys those sections read, and so do its activity and agent runs,
// which the conversation and the agent cost read the same way.

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
    if (url.pathname.endsWith('/activity')) {
      return Promise.resolve(
        json({
          activity: [
            {
              id: 'a1',
              organizationId: 'org-1',
              taskId: 'task-1',
              projectId: 'p1',
              actorType: 'user',
              actorId: 'u1',
              action: 'created',
              fromValue: null,
              toValue: null,
              createdAt: 1,
            },
          ],
        }),
      );
    }
    if (url.pathname.endsWith('/agent-runs')) {
      return Promise.resolve(
        json({
          runs: [
            {
              id: 'r1',
              agentId: 'coder',
              status: 'completed',
              error: null,
              failureCode: null,
              trigger: null,
              waitingForCapacityAt: null,
              startedAt: 1,
              launchedAt: 1,
              settledAt: 2,
            },
          ],
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
  it('starts the discussion, dependencies, reviewer, watch, activity and agent-run reads with the task', async () => {
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
          '/api/app/tasks/task-1/activity',
          '/api/app/tasks/task-1/agent-runs',
        ]),
      ),
    );
    expect(discussionPageSizes).toEqual(['30']);

    // What the sections read is what was already fetched.
    const reads = requested.length;
    const { result } = renderHook(
      () => ({
        discussion: useTaskDiscussion('task-1'),
        activity: useTaskActivity('task-1'),
        agentRuns: useTaskAgentRuns('task-1'),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.discussion.comments).toHaveLength(1);
      expect(result.current.activity.activity.map((item) => item._id)).toEqual([
        'a1',
      ]);
      expect(result.current.agentRuns.runs.map((run) => run.runId)).toEqual([
        'r1',
      ]);
    });
    expect(requested).toHaveLength(reads);
  });

  it('does nothing without a cache in scope', () => {
    expect(() =>
      renderHook(() => usePrefetchTaskReads('task-1')),
    ).not.toThrow();
    expect(requested).toEqual([]);
  });
});
