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
          getEventSubscriptions: 'getEventSubscriptions-ref',
        },
      },
    },
  },
}));

import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { createWfEventSubscriptionsCollection } from '../wf-event-subscriptions';

const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);
const mockQueryClient = {} as Parameters<
  typeof createWfEventSubscriptionsCollection
>[1];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<
  typeof createWfEventSubscriptionsCollection
>[3];

describe('createWfEventSubscriptionsCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection options with correct id and query', () => {
    createWfEventSubscriptionsCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);
    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config).toMatchObject({
      id: 'wf-event-subscriptions',
      queryKey: [
        'convexQuery',
        'getEventSubscriptions-ref',
        { workflowRootId: 'root-123' },
      ],
      staleTime: Infinity,
    });
  });

  it('provides a queryFn wrapper', () => {
    createWfEventSubscriptionsCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.queryFn).toBeTypeOf('function');
  });

  it('uses _id as the collection key', () => {
    createWfEventSubscriptionsCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    const getKey = config.getKey as (item: { _id: string }) => string;
    expect(getKey({ _id: 'sub-abc' })).toBe('sub-abc');
  });

  it('defines mutation handlers', () => {
    createWfEventSubscriptionsCollection(
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
    createWfEventSubscriptionsCollection(
      'root-1',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );
    createWfEventSubscriptionsCollection(
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
