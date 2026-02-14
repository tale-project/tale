import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((options: { mutationFn: unknown }) => ({
    mutate: options.mutationFn,
    mutateAsync: options.mutationFn,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  })),
}));

vi.mock('../use-convex-client', () => ({
  useConvexClient: () => ({
    action: vi.fn(),
  }),
}));

import { useConvexAction } from '../use-convex-action';

const mockActionRef = {} as Parameters<typeof useConvexAction>[0];

describe('useConvexAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object with mutateAsync', () => {
    const result = useConvexAction(mockActionRef);
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('mutate');
    expect(result).toHaveProperty('isPending');
  });

  it('returns isPending as false initially', () => {
    const result = useConvexAction(mockActionRef);
    expect(result.isPending).toBe(false);
  });
});
