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

vi.mock('@/convex/_generated/api', () => ({
  api: {
    custom_agents: {
      webhooks: {
        queries: {
          getWebhooks: 'getWebhooks-ref',
        },
      },
    },
  },
}));

import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { createCustomAgentWebhooksCollection } from '../custom-agent-webhooks';

const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);
const mockQueryClient = {} as Parameters<
  typeof createCustomAgentWebhooksCollection
>[1];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<
  typeof createCustomAgentWebhooksCollection
>[3];

describe('createCustomAgentWebhooksCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection options with correct id and query', () => {
    createCustomAgentWebhooksCollection(
      'agent-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);
    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config).toMatchObject({
      id: 'custom-agent-webhooks',
      queryKey: [
        'convexQuery',
        'getWebhooks-ref',
        { customAgentId: 'agent-123' },
      ],
      staleTime: Infinity,
    });
  });

  it('provides a queryFn wrapper', () => {
    createCustomAgentWebhooksCollection(
      'agent-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.queryFn).toBeTypeOf('function');
  });

  it('uses _id as the collection key', () => {
    createCustomAgentWebhooksCollection(
      'agent-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    const getKey = config.getKey as (item: { _id: string }) => string;
    expect(getKey({ _id: 'wh-abc' })).toBe('wh-abc');
  });

  it('defines mutation handlers', () => {
    createCustomAgentWebhooksCollection(
      'agent-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.onInsert).toBeUndefined();
    expect(config.onUpdate).toBeDefined();
    expect(config.onDelete).toBeDefined();
  });

  it('scopes by customAgentId', () => {
    createCustomAgentWebhooksCollection(
      'agent-1',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );
    createCustomAgentWebhooksCollection(
      'agent-2',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config1 = mockQueryCollectionOptions.mock.calls[0][0];
    const config2 = mockQueryCollectionOptions.mock.calls[1][0];
    expect(config1.queryKey).toContainEqual({ customAgentId: 'agent-1' });
    expect(config2.queryKey).toContainEqual({ customAgentId: 'agent-2' });
  });
});
