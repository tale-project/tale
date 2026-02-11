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
    wf_step_defs: {
      queries: {
        getWorkflowSteps: 'getWorkflowSteps-ref',
      },
    },
  },
}));

import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { createWfStepsCollection } from '../wf-steps';

const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);
const mockQueryClient = {} as Parameters<typeof createWfStepsCollection>[1];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<typeof createWfStepsCollection>[3];

describe('createWfStepsCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection options with correct id and query', () => {
    createWfStepsCollection(
      'def-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);
    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config).toMatchObject({
      id: 'wf-steps',
      queryKey: [
        'convexQuery',
        'getWorkflowSteps-ref',
        { wfDefinitionId: 'def-123' },
      ],
      staleTime: Infinity,
    });
  });

  it('provides a queryFn wrapper', () => {
    createWfStepsCollection(
      'def-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.queryFn).toBeTypeOf('function');
  });

  it('uses _id as the collection key', () => {
    createWfStepsCollection(
      'def-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    const getKey = config.getKey as (item: { _id: string }) => string;
    expect(getKey({ _id: 'step-abc' })).toBe('step-abc');
  });

  it('does not define mutation handlers', () => {
    createWfStepsCollection(
      'def-123',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config = mockQueryCollectionOptions.mock.calls[0][0];
    expect(config.onInsert).toBeUndefined();
    expect(config.onUpdate).toBeUndefined();
    expect(config.onDelete).toBeUndefined();
  });

  it('scopes by wfDefinitionId', () => {
    createWfStepsCollection(
      'def-1',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );
    createWfStepsCollection(
      'def-2',
      mockQueryClient,
      mockConvexQueryFn,
      mockConvexClient,
    );

    const config1 = mockQueryCollectionOptions.mock.calls[0][0];
    const config2 = mockQueryCollectionOptions.mock.calls[1][0];
    expect(config1.queryKey).toContainEqual({ wfDefinitionId: 'def-1' });
    expect(config2.queryKey).toContainEqual({ wfDefinitionId: 'def-2' });
  });
});
