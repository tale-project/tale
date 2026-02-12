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
          getWebhooks: 'getWebhooks-ref',
        },
      },
    },
  },
}));

import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { createWfWebhooksCollection } from '../wf-webhooks';

const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);
const mockQueryClient = {} as Parameters<typeof createWfWebhooksCollection>[1];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<typeof createWfWebhooksCollection>[3];

describe('createWfWebhooksCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection options with correct id and query', () => {
    createWfWebhooksCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);
    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config).toMatchObject({
      id: 'wf-webhooks',
      queryKey: [
        'convexQuery',
        'getWebhooks-ref',
        { workflowRootId: 'root-123' },
      ],
      staleTime: Infinity,
    });
  });

  it('provides a queryFn wrapper', () => {
    createWfWebhooksCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.queryFn).toBeTypeOf('function');
  });

  it('uses _id as the collection key', () => {
    createWfWebhooksCollection(
      'root-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    const getKey = config.getKey as (item: { _id: string }) => string;
    expect(getKey({ _id: 'wh-abc' })).toBe('wh-abc');
  });

  it('defines mutation handlers', () => {
    createWfWebhooksCollection(
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
    createWfWebhooksCollection(
      'root-1',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );
    createWfWebhooksCollection(
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
