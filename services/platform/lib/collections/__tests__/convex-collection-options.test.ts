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

import { convexQuery } from '@convex-dev/react-query';
import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { convexCollectionOptions } from '../convex-collection-options';

const mockConvexQuery = vi.mocked(convexQuery);
const mockQueryCollectionOptions = vi.mocked(queryCollectionOptions);

const mockFuncRef = {} as Parameters<
  typeof convexCollectionOptions
>[0]['queryFn'];
const mockQueryClient = {} as Parameters<
  typeof convexCollectionOptions
>[0]['queryClient'];
const mockConvexQueryFn = vi.fn();

describe('convexCollectionOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes convexQuery queryKey to queryCollectionOptions', () => {
    const args = { organizationId: 'org-123' };

    convexCollectionOptions({
      id: 'test',
      queryFn: mockFuncRef,
      args,
      queryClient: mockQueryClient,
      convexQueryFn: mockConvexQueryFn,
      getKey: (item: { _id: string }) => item._id,
    });

    expect(mockConvexQuery).toHaveBeenCalledWith(mockFuncRef, args);
    expect(mockQueryCollectionOptions).toHaveBeenCalledTimes(1);

    const passedConfig = mockQueryCollectionOptions.mock.calls[0][0];
    expect(passedConfig).toMatchObject({
      id: 'test',
      queryKey: ['convexQuery', mockFuncRef, args],
      queryClient: mockQueryClient,
      staleTime: Infinity,
    });
  });

  it('wraps convexQueryFn in an async queryFn that delegates and casts', async () => {
    convexCollectionOptions({
      id: 'test',
      queryFn: mockFuncRef,
      args: { organizationId: 'org-123' },
      queryClient: mockQueryClient,
      convexQueryFn: mockConvexQueryFn,
      getKey: (item: { _id: string }) => item._id,
    });

    const passedConfig = mockQueryCollectionOptions.mock.calls[0][0];
    expect(passedConfig.queryFn).toBeTypeOf('function');

    const mockData = [{ _id: '1', name: 'Test' }];
    mockConvexQueryFn.mockResolvedValueOnce(mockData);
    const mockCtx = {
      queryKey: ['test'],
      signal: new AbortController().signal,
      meta: undefined,
    };
    const queryFn = passedConfig.queryFn as (ctx: unknown) => Promise<unknown>;
    const result = await queryFn(mockCtx);

    expect(mockConvexQueryFn).toHaveBeenCalledWith(mockCtx);
    expect(result).toEqual(mockData);
  });

  it('wraps mutation handlers to return { refetch: false }', async () => {
    const onInsert = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);

    convexCollectionOptions({
      id: 'test',
      queryFn: mockFuncRef,
      args: { organizationId: 'org-123' },
      queryClient: mockQueryClient,
      convexQueryFn: mockConvexQueryFn,
      getKey: (item: { _id: string }) => item._id,
      onInsert,
      onUpdate,
      onDelete,
    });

    const passedConfig = mockQueryCollectionOptions.mock.calls[0][0];

    const mockParams = { transaction: { mutations: [] }, collection: {} };

    const insertResult = await passedConfig.onInsert?.(mockParams as never);
    expect(onInsert).toHaveBeenCalledWith(mockParams);
    expect(insertResult).toEqual({ refetch: false });

    const updateResult = await passedConfig.onUpdate?.(mockParams as never);
    expect(onUpdate).toHaveBeenCalledWith(mockParams);
    expect(updateResult).toEqual({ refetch: false });

    const deleteResult = await passedConfig.onDelete?.(mockParams as never);
    expect(onDelete).toHaveBeenCalledWith(mockParams);
    expect(deleteResult).toEqual({ refetch: false });
  });

  it('omits mutation handlers when not provided', () => {
    convexCollectionOptions({
      id: 'test',
      queryFn: mockFuncRef,
      args: { organizationId: 'org-123' },
      queryClient: mockQueryClient,
      convexQueryFn: mockConvexQueryFn,
      getKey: (item: { _id: string }) => item._id,
    });

    const passedConfig = mockQueryCollectionOptions.mock.calls[0][0];
    expect(passedConfig.onInsert).toBeUndefined();
    expect(passedConfig.onUpdate).toBeUndefined();
    expect(passedConfig.onDelete).toBeUndefined();
  });
});
