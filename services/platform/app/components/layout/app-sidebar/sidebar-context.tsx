'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

interface SidebarContextValue {
  /** Mobile unified drawer (nav + chat history). Session-only. */
  isMobileSheetOpen: boolean;
  setMobileSheetOpen: Dispatch<SetStateAction<boolean>>;
  /** Global search palette (chats + tasks). Session-only. ⌘K / Ctrl+K. */
  isSearchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  /** Chat-scoped search palette (chats only). Session-only. */
  isChatSearchOpen: boolean;
  setChatSearchOpen: Dispatch<SetStateAction<boolean>>;
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
 * opening the ⌘K palette) and should disappear — not crash — in a render
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
 * drawer and the global chat-search palette. Lives in the dashboard layout so
 * the sidebar, the chat header's mobile bar, the chat sub-panel, and the
 * shared ⌘K shortcut read one source of truth on every route. The sidebar's
 * width itself is viewport-driven (icon rail below `lg`, expanded panel from
 * `lg` up) — there is no user-toggled collapse.
 */
export function SidebarProvider({ children }: SidebarProviderProps) {
  const [isMobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [isChatSearchOpen, setChatSearchOpen] = useState(false);

  const value = useMemo(
    () => ({
      isMobileSheetOpen,
      setMobileSheetOpen,
      isSearchOpen,
      setSearchOpen,
      isChatSearchOpen,
      setChatSearchOpen,
    }),
    [isMobileSheetOpen, isSearchOpen, isChatSearchOpen],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}
