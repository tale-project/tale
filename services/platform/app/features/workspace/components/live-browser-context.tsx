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
  /** When true the pane connects with `?control=1` (writable VNC, human
   * takeover) instead of the read-only mirror. Set by the in-pane Take/Release
   * control toggle or the agent's take-control card; the strip/menu always open
   * in view mode. */
  control: boolean;
}

interface LiveBrowserContextType extends LiveBrowserState {
  /** Open the pane. `control: true` requests the writable takeover stream. */
  open: (opts?: { control?: boolean }) => void;
  close: () => void;
  toggle: () => void;
  /** Flip control on/off without closing the pane (e.g. on "return control"). */
  setControl: (control: boolean) => void;
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
  const [control, setControlState] = useState(false);

  // Reset to closed (and view-only) on every thread switch.
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (prevThreadIdRef.current !== threadId) {
      setIsOpen(false);
      setControlState(false);
      prevThreadIdRef.current = threadId;
    }
  }, [threadId]);

  const open = useCallback((opts?: { control?: boolean }) => {
    setControlState(opts?.control === true);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
    setControlState(false);
  }, []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const setControl = useCallback((next: boolean) => setControlState(next), []);

  const value = useMemo<LiveBrowserContextType>(
    () => ({ isOpen, control, open, close, toggle, setControl }),
    [isOpen, control, open, close, toggle, setControl],
  );

  return (
    <LiveBrowserContext.Provider value={value}>
      {children}
    </LiveBrowserContext.Provider>
  );
}
