import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));
vi.mock('@/app/lib/backend/account', () => ({
  currentUserQuery: () => ({ queryKey: ['backend', 'me', 'account', 'user'] }),
}));

const { useAuth, useSessionUser } = await import('./use-session-user');

/** Answer the session probe with a user, and the Better Auth session read
 * with `session`. */
function answerSession(session: Record<string, unknown>) {
  mockUseQuery.mockImplementation((options: { queryKey: readonly string[] }) =>
    options.queryKey[0] === 'auth'
      ? { data: { data: { user: { id: 'u1' }, session }, error: null } }
      : { data: { id: 'u1' }, isLoading: false },
  );
}

describe('useAuth', () => {
  // The proxy owns signing in and out for a session it asserted. A single
  // sign-on session is bound to its organization as well, but asserts no
  // role: its person signs out and back in through the app.
  it('leaves signing out to the proxy only for a session a proxy asserted', () => {
    answerSession({ trustedOrganizationId: 'org-1', trustedRole: 'member' });
    expect(renderHook(() => useAuth()).result.current.proxied).toBe(true);

    answerSession({ trustedOrganizationId: 'org-1', trustedRole: null });
    expect(renderHook(() => useAuth()).result.current.proxied).toBe(false);

    answerSession({ trustedOrganizationId: null, trustedRole: null });
    expect(renderHook(() => useAuth()).result.current.proxied).toBe(false);
  });
});

describe('useSessionUser', () => {
  it('reports the session probe, not a websocket handshake', () => {
    mockUseQuery.mockReturnValue({ data: { id: 'u1' }, isLoading: false });
    expect(renderHook(() => useSessionUser()).result.current).toEqual({
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true });
    expect(renderHook(() => useSessionUser()).result.current).toEqual({
      isAuthenticated: false,
      isLoading: true,
    });
  });

  it('reads a 401 (no user) as signed out, not as still loading', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false });
    expect(renderHook(() => useSessionUser()).result.current).toEqual({
      isAuthenticated: false,
      isLoading: false,
    });
  });
});
