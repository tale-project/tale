'use client';

import { useMatch } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  CHAT_PANE_ORDER,
  type ChatPaneDescriptor,
  type ChatPaneId,
} from './types';

interface ChatPanelContextType {
  /** Register or replace a pane's descriptor (called by `useRegisterPane`). */
  registerPane: (descriptor: ChatPaneDescriptor) => void;
  /** Remove a pane's descriptor on unmount. */
  unregisterPane: (id: ChatPaneId) => void;
  /** All registered descriptors that currently have content, in stable order. */
  visiblePanes: ChatPaneDescriptor[];
  /** Which pane is shown when maximized; null when nothing is visible. */
  activeTab: ChatPaneId | null;
  /** Maximized (full pane + tabs) vs minimized (the shared strip). */
  isMaximized: boolean;
  /**
   * Whether the maximized pane is expanded to a full-viewport overlay (desktop
   * only — mobile is already full-width). Lets a cramped docked panel grow to
   * the whole window for reading documents / the live browser, then snap back.
   */
  isFullscreen: boolean;
  /** Open a pane maximized and make it the active tab. */
  openPane: (id: ChatPaneId) => void;
  /** Collapse to the strip without losing content (never a dead-end). */
  minimize: () => void;
  /** Toggle the full-viewport overlay on the maximized pane (desktop only). */
  toggleFullscreen: () => void;
  /** Clear shell state — used on new-chat / thread switch. */
  reset: () => void;
}

const ChatPanelContext = createContext<ChatPanelContextType | null>(null);

export function useChatPanel() {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) {
    throw new Error('useChatPanel must be used within ChatPanelProvider');
  }
  return ctx;
}

const ORDER_INDEX = new Map<ChatPaneId, number>(
  CHAT_PANE_ORDER.map((id, index) => [id, index]),
);

function byOrder(a: ChatPaneDescriptor, b: ChatPaneDescriptor): number {
  return (ORDER_INDEX.get(a.id) ?? 0) - (ORDER_INDEX.get(b.id) ?? 0);
}

interface ChatPanelProviderProps {
  children: ReactNode;
}

/**
 * Owns the unified right-side panel: a registry of pane descriptors plus the
 * ephemeral shell state (`activeTab` + `isMaximized`). Each of the four panes
 * registers a descriptor; the `<ChatPanel>` shell renders the live set.
 *
 * State is intentionally session-local (no Convex persistence): the sandbox
 * panes are documented transient affordances, the plan pane was already local,
 * and only the canvas's active-file path persists — and that stays in
 * `WorkspaceProvider`, untouched. Shell state resets on every thread switch so
 * a new chat never inherits the previous thread's open tab.
 */
export function ChatPanelProvider({ children }: ChatPanelProviderProps) {
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  // Registry keyed by id. A Map kept in state so re-registration (descriptor
  // changes on every render of a pane) replaces in place and re-renders the
  // shell with the latest body/badge/hasContent.
  const [registry, setRegistry] = useState(
    () => new Map<ChatPaneId, ChatPaneDescriptor>(),
  );
  const [activeTab, setActiveTab] = useState<ChatPaneId | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const registerPane = useCallback((descriptor: ChatPaneDescriptor) => {
    setRegistry((prev) => {
      const existing = prev.get(descriptor.id);
      if (existing && shallowEqualDescriptor(existing, descriptor)) {
        return prev;
      }
      const next = new Map(prev);
      next.set(descriptor.id, descriptor);
      return next;
    });
  }, []);

  const unregisterPane = useCallback((id: ChatPaneId) => {
    setRegistry((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const visiblePanes = useMemo(
    () => [...registry.values()].filter((d) => d.hasContent).sort(byOrder),
    [registry],
  );

  const openPane = useCallback((id: ChatPaneId) => {
    setActiveTab(id);
    setIsMaximized(true);
  }, []);

  // Collapsing to the strip also leaves fullscreen, so re-opening starts docked.
  const minimize = useCallback(() => {
    setIsMaximized(false);
    setIsFullscreen(false);
  }, []);

  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), []);

  const reset = useCallback(() => {
    setActiveTab(null);
    setIsMaximized(false);
    setIsFullscreen(false);
  }, []);

  // Reset shell state on every thread switch (mirrors the per-thread reset in
  // the workspace/files/browser contexts) so a different chat never opens onto
  // the previous thread's tab.
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (prevThreadIdRef.current !== threadId) {
      setActiveTab(null);
      setIsMaximized(false);
      setIsFullscreen(false);
      prevThreadIdRef.current = threadId;
    }
  }, [threadId]);

  // Invariants: keep `activeTab` pointing at a still-visible pane, and force
  // the collapsed/empty state when nothing is visible. Without this the Tabs
  // control could be handed a `value` with no matching trigger when a pane
  // loses content (e.g. a sandbox session ends).
  useEffect(() => {
    if (visiblePanes.length === 0) {
      if (activeTab !== null) setActiveTab(null);
      if (isMaximized) setIsMaximized(false);
      if (isFullscreen) setIsFullscreen(false);
      return;
    }
    const stillVisible =
      activeTab !== null && visiblePanes.some((d) => d.id === activeTab);
    if (!stillVisible) {
      setActiveTab(visiblePanes[0].id);
    }
  }, [visiblePanes, activeTab, isMaximized, isFullscreen]);

  const value = useMemo<ChatPanelContextType>(
    () => ({
      registerPane,
      unregisterPane,
      visiblePanes,
      activeTab,
      isMaximized,
      isFullscreen,
      openPane,
      minimize,
      toggleFullscreen,
      reset,
    }),
    [
      registerPane,
      unregisterPane,
      visiblePanes,
      activeTab,
      isMaximized,
      isFullscreen,
      openPane,
      minimize,
      toggleFullscreen,
      reset,
    ],
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}

/**
 * Cheap structural compare so re-registering an unchanged descriptor doesn't
 * churn the registry (and re-render the shell). `body`/`headerActions` are
 * fresh React elements every render, so they're compared by reference — a
 * pane that rebuilds its body each render will update, which is correct; the
 * guard only short-circuits the common case where nothing changed.
 */
function shallowEqualDescriptor(
  a: ChatPaneDescriptor,
  b: ChatPaneDescriptor,
): boolean {
  return (
    a.id === b.id &&
    a.icon === b.icon &&
    a.label === b.label &&
    a.ariaLabel === b.ariaLabel &&
    a.badge === b.badge &&
    a.hasContent === b.hasContent &&
    a.body === b.body &&
    a.headerActions === b.headerActions
  );
}
