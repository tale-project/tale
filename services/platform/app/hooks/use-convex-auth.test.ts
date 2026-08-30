import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));
vi.mock('@/app/lib/backend/account', () => ({
  currentUserQuery: () => ({ queryKey: ['backend', 'me', 'account', 'user'] }),
}));

const { useConvexAuth } = await import('./use-convex-auth');

describe('useConvexAuth', () => {
  it('reports the session probe, not a websocket handshake', () => {
    mockUseQuery.mockReturnValue({ data: { id: 'u1' }, isLoading: false });
    expect(renderHook(() => useConvexAuth()).result.current).toEqual({
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true });
    expect(renderHook(() => useConvexAuth()).result.current).toEqual({
      isAuthenticated: false,
      isLoading: true,
    });
  });

  it('reads a 401 (no user) as signed out, not as still loading', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false });
    expect(renderHook(() => useConvexAuth()).result.current).toEqual({
      isAuthenticated: false,
      isLoading: false,
    });
  });
});
