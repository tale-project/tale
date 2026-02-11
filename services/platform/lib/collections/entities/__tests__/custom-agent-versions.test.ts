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
      queries: {
        getCustomAgentVersions: 'getCustomAgentVersions-ref',
      },
    },
  },
}));

import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { createCustomAgentVersionsCollection } from '../custom-agent-versions';

const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);
const mockQueryClient = {} as Parameters<
  typeof createCustomAgentVersionsCollection
>[1];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<
  typeof createCustomAgentVersionsCollection
>[3];

describe('createCustomAgentVersionsCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection options with correct id and query', () => {
    createCustomAgentVersionsCollection(
      'agent-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);
    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config).toMatchObject({
      id: 'custom-agent-versions',
      queryKey: [
        'convexQuery',
        'getCustomAgentVersions-ref',
        { customAgentId: 'agent-123' },
      ],
      staleTime: Infinity,
    });
  });

  it('provides a queryFn wrapper', () => {
    createCustomAgentVersionsCollection(
      'agent-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.queryFn).toBeTypeOf('function');
  });

  it('uses _id as the collection key', () => {
    createCustomAgentVersionsCollection(
      'agent-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    const getKey = config.getKey as (item: { _id: string }) => string;
    expect(getKey({ _id: 'ver-abc' })).toBe('ver-abc');
  });

  it('does not define mutation handlers', () => {
    createCustomAgentVersionsCollection(
      'agent-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.onInsert).toBeUndefined();
    expect(config.onUpdate).toBeUndefined();
    expect(config.onDelete).toBeUndefined();
  });

  it('scopes by customAgentId', () => {
    createCustomAgentVersionsCollection(
      'agent-1',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );
    createCustomAgentVersionsCollection(
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
