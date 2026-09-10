// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SidebarProvider, useSidebar } from './sidebar-context';

function wrapper({ children }: { children: ReactNode }) {
  return <SidebarProvider>{children}</SidebarProvider>;
}

describe('SidebarProvider', () => {
  it('mobile sheet and search palette state are session-only', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isMobileSheetOpen).toBe(false);
    expect(result.current.isSearchOpen).toBe(false);
    expect(result.current.searchScope).toBe('everything');

    act(() => result.current.setMobileSheetOpen(true));
    act(() => result.current.openSearch('chats'));
    expect(result.current.isMobileSheetOpen).toBe(true);
    expect(result.current.isSearchOpen).toBe(true);
    expect(result.current.searchScope).toBe('chats');
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
