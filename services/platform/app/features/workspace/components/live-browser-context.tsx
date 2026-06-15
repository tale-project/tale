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

interface LiveBrowserState {
  isOpen: boolean;
}

interface LiveBrowserContextType extends LiveBrowserState {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const LiveBrowserContext = createContext<LiveBrowserContextType | null>(null);

export function useLiveBrowser() {
  const ctx = useContext(LiveBrowserContext);
  if (!ctx) {
    throw new Error('useLiveBrowser must be used within LiveBrowserProvider');
  }
  return ctx;
}

export function useLiveBrowserOptional() {
  return useContext(LiveBrowserContext);
}

interface LiveBrowserProviderProps {
  children: ReactNode;
}

/**
 * Per-thread open-state for the read-only "Live browser" pane — a near-video
 * VNC stream of the external-agent's headed Chromium (external-agent sandbox
 * threads only). Like `WorkspaceFilesProvider`, this is intentionally LOCAL
 * React state with no Convex persistence: the stream is a transient,
 * device-local viewing affordance, not thread state that should follow the
 * user across devices.
 *
 * The pane closes on every thread switch so navigating into a different chat
 * (or back to the new-chat surface) never inherits the previous thread's open
 * stream (and never strands a live WebSocket on the wrong thread).
 */
export function LiveBrowserProvider({ children }: LiveBrowserProviderProps) {
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const [isOpen, setIsOpen] = useState(false);

  // Reset to closed on every thread switch.
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (prevThreadIdRef.current !== threadId) {
      setIsOpen(false);
      prevThreadIdRef.current = threadId;
    }
  }, [threadId]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const value = useMemo<LiveBrowserContextType>(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  );

  return (
    <LiveBrowserContext.Provider value={value}>
      {children}
    </LiveBrowserContext.Provider>
  );
}
