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
    wf_definitions: {
      queries: {
        listAutomations: 'listAutomations-ref',
      },
    },
  },
}));

import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { createWfAutomationsCollection } from '../wf-automations';

const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);
const mockQueryClient = {} as Parameters<
  typeof createWfAutomationsCollection
>[1];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<
  typeof createWfAutomationsCollection
>[3];

describe('createWfAutomationsCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection options with correct id and query', () => {
    createWfAutomationsCollection(
      'org-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);
    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config).toMatchObject({
      id: 'wf-automations',
      queryKey: [
        'convexQuery',
        'listAutomations-ref',
        { organizationId: 'org-123' },
      ],
      staleTime: Infinity,
    });
  });

  it('provides a queryFn wrapper', () => {
    createWfAutomationsCollection(
      'org-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.queryFn).toBeTypeOf('function');
  });

  it('uses _id as the collection key', () => {
    createWfAutomationsCollection(
      'org-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    const getKey = config.getKey as (item: { _id: string }) => string;
    expect(getKey({ _id: 'wf-abc' })).toBe('wf-abc');
  });

  it('defines mutation handlers', () => {
    createWfAutomationsCollection(
      'org-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.onInsert).toBeUndefined();
    expect(config.onUpdate).toBeDefined();
    expect(config.onDelete).toBeDefined();
  });

  it('passes different args per organization', () => {
    createWfAutomationsCollection(
      'org-1',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );
    createWfAutomationsCollection(
      'org-2',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config1 = mockQueryCollectionOptions.mock.calls[0][0];
    const config2 = mockQueryCollectionOptions.mock.calls[1][0];
    expect(config1.queryKey).toContainEqual({ organizationId: 'org-1' });
    expect(config2.queryKey).toContainEqual({ organizationId: 'org-2' });
  });
});
