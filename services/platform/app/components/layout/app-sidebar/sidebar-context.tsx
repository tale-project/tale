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

import { useAuth } from '@/app/hooks/use-convex-auth';
import { usePersistedState } from '@/app/hooks/use-persisted-state';

interface SidebarContextValue {
  /** Desktop sidebar expanded (full panel) vs collapsed (icon rail). */
  isExpanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  toggleExpanded: () => void;
  /** Mobile unified drawer (nav + chat history). Session-only. */
  isMobileSheetOpen: boolean;
  setMobileSheetOpen: Dispatch<SetStateAction<boolean>>;
  /** Global chat-search palette (SearchCommand). Session-only. */
  isSearchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
}

interface SidebarProviderProps {
  organizationId: string;
  children: ReactNode;
}

/**
 * Shell-level state for the unified app sidebar: the desktop expand/collapse
 * preference (persisted per user+org, default expanded), the mobile drawer, and
 * the global chat-search palette. Lives in the dashboard layout so the sidebar,
 * the chat header's mobile bar, and the shared keyboard shortcuts (⌘H / ⌘K)
 * read one source of truth on every route.
 */
export function SidebarProvider({
  organizationId,
  children,
}: SidebarProviderProps) {
  const { user } = useAuth();
  // Same per-user+org key pattern as ChatLayoutProvider's persisted prefs; the
  // org-only fallback covers the brief window before auth resolves —
  // usePersistedState re-reads storage when the key upgrades to the
  // user-scoped one.
  const expandedKey = user?.userId
    ? `app-sidebar-expanded-${user.userId}-${organizationId}`
    : `app-sidebar-expanded-${organizationId}`;
  const [isExpanded, setExpanded] = usePersistedState(expandedKey, true);
  const [isMobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, [setExpanded]);

  const value = useMemo(
    () => ({
      isExpanded,
      setExpanded,
      toggleExpanded,
      isMobileSheetOpen,
      setMobileSheetOpen,
      isSearchOpen,
      setSearchOpen,
    }),
    [isExpanded, setExpanded, toggleExpanded, isMobileSheetOpen, isSearchOpen],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}
