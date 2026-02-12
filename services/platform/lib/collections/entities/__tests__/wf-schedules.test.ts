import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: vi.fn((...args: unknown[]) => ({
    queryKey: ['convexQuery', ...args],
  })),
}));

vi.mock('@tanstack/query-db-collection', () => ({
  queryCollectionOptions: vi.fn((config: Record<string, unknown>) => ({
    ...config,
    _type: 'queryCollectionOptions',
  })),
}));

vi.mock('@/lib/utils/type-guards', () => ({
  toId: vi.fn((id: string) => id),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    workflows: {
      triggers: {
        queries: {
          getSchedules: 'getSchedules-ref',
        },
      },
    },
  },
}));

import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { createWfSchedulesCollection } from '../wf-schedules';

const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);
const mockQueryClient = {} as Parameters<typeof createWfSchedulesCollection>[1];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<
  typeof createWfSchedulesCollection
>[3];

describe('createWfSchedulesCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection options with correct id and query', () => {
    createWfSchedulesCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);
    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config).toMatchObject({
      id: 'wf-schedules',
      queryKey: [
        'convexQuery',
        'getSchedules-ref',
        { workflowRootId: 'root-123' },
      ],
      staleTime: Infinity,
    });
  });

  it('provides a queryFn wrapper', () => {
    createWfSchedulesCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.queryFn).toBeTypeOf('function');
  });

  it('uses _id as the collection key', () => {
    createWfSchedulesCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    const getKey = config.getKey as (item: { _id: string }) => string;
    expect(getKey({ _id: 'schedule-abc' })).toBe('schedule-abc');
  });

  it('defines mutation handlers', () => {
    createWfSchedulesCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.onInsert).toBeDefined();
    expect(config.onUpdate).toBeDefined();
    expect(config.onDelete).toBeDefined();
  });

  it('scopes by workflowRootId', () => {
    createWfSchedulesCollection(
      'root-1',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );
    createWfSchedulesCollection(
      'root-2',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config1 = mockQueryCollectionOptions.mock.calls[0][0];
    const config2 = mockQueryCollectionOptions.mock.calls[1][0];
    expect(config1.queryKey).toContainEqual({ workflowRootId: 'root-1' });
    expect(config2.queryKey).toContainEqual({ workflowRootId: 'root-2' });
  });
});
