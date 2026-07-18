// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/hooks/use-convex-auth', () => ({
  useAuth: () => ({ user: { userId: 'user_1' } }),
}));

import { SidebarProvider, useSidebar } from './sidebar-context';

function wrapper({ children }: { children: ReactNode }) {
  return <SidebarProvider organizationId="org_1">{children}</SidebarProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
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
