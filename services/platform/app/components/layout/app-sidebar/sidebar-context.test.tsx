// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState } = vi.hoisted(() => ({
  authState: { user: { userId: 'user_1' } as { userId: string } | null },
}));

vi.mock('@/app/hooks/use-convex-auth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

import { SidebarProvider, useSidebar } from './sidebar-context';

function wrapper({ children }: { children: ReactNode }) {
  return <SidebarProvider organizationId="org_1">{children}</SidebarProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  authState.user = { userId: 'user_1' };
});

describe('SidebarProvider', () => {
  it('defaults to expanded when no preference is stored', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isExpanded).toBe(true);
  });

  it('toggleExpanded flips and persists the per-user+org preference', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => result.current.toggleExpanded());
    expect(result.current.isExpanded).toBe(false);
    expect(
      window.localStorage.getItem('app-sidebar-expanded-user_1-org_1'),
    ).toBe('false');

    act(() => result.current.toggleExpanded());
    expect(result.current.isExpanded).toBe(true);
  });

  it('restores a stored collapsed preference', () => {
    window.localStorage.setItem('app-sidebar-expanded-user_1-org_1', 'false');
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isExpanded).toBe(false);
  });

  it('first paint before auth resolves uses the org-scan hint (no expanded flash)', () => {
    // Pre-auth the user-scoped key is unknowable; the org-scan hint (any
    // user's key under this org) must make the FIRST render collapsed.
    authState.user = null;
    window.localStorage.setItem('app-sidebar-expanded-user_1-org_1', 'false');
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isExpanded).toBe(false);
  });

  it('ignores hints from other orgs before auth resolves', () => {
    authState.user = null;
    window.localStorage.setItem('app-sidebar-expanded-user_1-org_2', 'false');
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isExpanded).toBe(true);
  });

  it('mobile sheet and search palette state are session-only and independent', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isMobileSheetOpen).toBe(false);
    expect(result.current.isSearchOpen).toBe(false);

    act(() => result.current.setMobileSheetOpen(true));
    act(() => result.current.setSearchOpen(true));
    expect(result.current.isMobileSheetOpen).toBe(true);
    expect(result.current.isSearchOpen).toBe(true);
    // Neither is written to storage — ephemeral by design.
    expect(window.localStorage.length).toBe(0);
  });

  it('useSidebar throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useSidebar())).toThrow(
      'useSidebar must be used within SidebarProvider',
    );
    spy.mockRestore();
  });
});
