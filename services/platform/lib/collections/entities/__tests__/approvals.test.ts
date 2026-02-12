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
    approvals: {
      queries: {
        listApprovalsByOrganization: 'listApprovalsByOrganization-ref',
      },
    },
  },
}));

import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { createApprovalsCollection } from '../approvals';

const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);
const mockQueryClient = {} as Parameters<typeof createApprovalsCollection>[1];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<typeof createApprovalsCollection>[3];

describe('createApprovalsCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection options with correct id and query', () => {
    createApprovalsCollection(
      'org-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);
    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config).toMatchObject({
      id: 'approvals',
      queryKey: [
        'convexQuery',
        'listApprovalsByOrganization-ref',
        { organizationId: 'org-123' },
      ],
      staleTime: Infinity,
    });
  });

  it('provides a queryFn wrapper', () => {
    createApprovalsCollection(
      'org-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.queryFn).toBeTypeOf('function');
  });

  it('uses _id as the collection key', () => {
    createApprovalsCollection(
      'org-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    const getKey = config.getKey as (item: { _id: string }) => string;
    expect(getKey({ _id: 'approval-abc' })).toBe('approval-abc');
  });

  it('defines mutation handlers', () => {
    createApprovalsCollection(
      'org-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.onInsert).toBeUndefined();
    expect(config.onUpdate).toBeDefined();
    expect(config.onDelete).toBeUndefined();
  });

  it('passes different args per organization', () => {
    createApprovalsCollection(
      'org-1',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );
    createApprovalsCollection(
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
