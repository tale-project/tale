// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseActiveApprovals } = vi.hoisted(() => ({
  mockUseActiveApprovals: vi.fn(),
}));

vi.mock('./queries', () => ({
  useActiveApprovals: mockUseActiveApprovals,
}));
vi.mock('@/convex/lib/type_cast_helpers', () => ({
  toId: (value: unknown) => value,
}));
vi.mock('@/convex/approvals/types', () => ({
  normalizeDocumentWriteMetadata: (metadata: unknown) => metadata,
}));

import { useThreadApprovals } from './use-thread-approvals';

function approval(overrides: Record<string, unknown>) {
  return {
    _id: 'id',
    threadId: 'thread-1',
    status: 'pending',
    metadata: {},
    _creationTime: 0,
    messageId: 'm',
    executedAt: undefined,
    executionError: undefined,
    wfExecutionId: undefined,
    ...overrides,
  };
}

describe('useThreadApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('partitions approvals by resourceType for the active thread', () => {
    mockUseActiveApprovals.mockReturnValue({
      isLoading: false,
      approvals: [
        approval({ _id: 'i1', resourceType: 'integration_operation' }),
        approval({ _id: 'w1', resourceType: 'workflow_creation' }),
        approval({
          _id: 'h1',
          resourceType: 'human_input_request',
          wfExecutionId: 'wf1',
        }),
        approval({
          _id: 'd1',
          resourceType: 'document_write',
          metadata: { path: '/a' },
        }),
      ],
    });

    const { result } = renderHook(() => useThreadApprovals('org', 'thread-1'));

    expect(result.current.integrationApprovals.map((a) => a._id)).toEqual([
      'i1',
    ]);
    expect(result.current.workflowCreationApprovals.map((a) => a._id)).toEqual([
      'w1',
    ]);
    expect(result.current.humanInputRequests.map((a) => a._id)).toEqual(['h1']);
    // Optional id fields are coerced through `toId` (identity in the test).
    expect(result.current.humanInputRequests[0]?.wfExecutionId).toBe('wf1');
    expect(result.current.documentWriteApprovals.map((a) => a._id)).toEqual([
      'd1',
    ]);
  });

  it('excludes rows from other threads and rows without metadata', () => {
    mockUseActiveApprovals.mockReturnValue({
      isLoading: false,
      approvals: [
        approval({ _id: 'mine', resourceType: 'integration_operation' }),
        approval({
          _id: 'other',
          resourceType: 'integration_operation',
          threadId: 'thread-2',
        }),
        approval({
          _id: 'nometa',
          resourceType: 'integration_operation',
          metadata: undefined,
        }),
      ],
    });

    const { result } = renderHook(() => useThreadApprovals('org', 'thread-1'));
    expect(result.current.integrationApprovals.map((a) => a._id)).toEqual([
      'mine',
    ]);
  });

  it('passes the loading flag through and yields empty buckets while loading', () => {
    mockUseActiveApprovals.mockReturnValue({
      isLoading: true,
      approvals: undefined,
    });

    const { result } = renderHook(() => useThreadApprovals('org', 'thread-1'));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.integrationApprovals).toEqual([]);
    expect(result.current.documentWriteApprovals).toEqual([]);
  });
});
