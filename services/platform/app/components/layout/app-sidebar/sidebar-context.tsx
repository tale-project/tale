'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

/** Scope for the shared shell search palette. */
export type SearchScope = 'chats' | 'everything';

interface SidebarContextValue {
  /** Mobile unified drawer (nav + chat history). Session-only. */
  isMobileSheetOpen: boolean;
  setMobileSheetOpen: Dispatch<SetStateAction<boolean>>;
  /** Shared search palette (⌘K / thread-list search). Session-only. */
  isSearchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  /** Chats-only vs org-wide results in the open palette. */
  searchScope: SearchScope;
  setSearchScope: Dispatch<SetStateAction<SearchScope>>;
  /** Open the palette in a given scope (default: everything). */
  openSearch: (scope?: SearchScope) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
}

/**
 * The sidebar context, or null outside a SidebarProvider. For affordances
 * that merely HOOK INTO sidebar surfaces (the chat panel's search button
 * opening the palette) and should disappear — not crash — in a render
 * without the provider, like a component test.
 */
export function useOptionalSidebar() {
  return useContext(SidebarContext);
}

interface SidebarProviderProps {
  children: ReactNode;
}

/**
 * Shell-level state for the app sidebar's session-only surfaces: the mobile
 * drawer and the shared search palette. Lives in the dashboard layout so the
 * sidebar, the chat header's mobile bar, the chat sub-panel, and the ⌘K
 * shortcut read one source of truth on every route. The sidebar's width
 * itself is viewport-driven (icon rail below `lg`, expanded panel from `lg`
 * up) — there is no user-toggled collapse.
 */
export function SidebarProvider({ children }: SidebarProviderProps) {
  const [isMobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<SearchScope>('everything');

  const openSearch = useCallback((scope: SearchScope = 'everything') => {
    setSearchScope(scope);
    setSearchOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      isMobileSheetOpen,
      setMobileSheetOpen,
      isSearchOpen,
      setSearchOpen,
      searchScope,
      setSearchScope,
      openSearch,
    }),
    [isMobileSheetOpen, isSearchOpen, searchScope, openSearch],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}
