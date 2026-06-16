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

interface WorkspaceFilesState {
  isOpen: boolean;
}

interface WorkspaceFilesContextType extends WorkspaceFilesState {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const WorkspaceFilesContext = createContext<WorkspaceFilesContextType | null>(
  null,
);

export function useWorkspaceFiles() {
  const ctx = useContext(WorkspaceFilesContext);
  if (!ctx) {
    throw new Error(
      'useWorkspaceFiles must be used within WorkspaceFilesProvider',
    );
  }
  return ctx;
}

export function useWorkspaceFilesOptional() {
  return useContext(WorkspaceFilesContext);
}

interface WorkspaceFilesProviderProps {
  children: ReactNode;
}

/**
 * Per-thread open-state for the read-only "Workspace files" explorer pane
 * (external-agent sandbox threads only). Unlike the canvas `WorkspaceProvider`,
 * this is intentionally LOCAL React state with no Convex persistence — the
 * explorer is a transient browsing affordance, not a piece of thread state that
 * should follow the user across devices.
 *
 * The pane closes on every thread switch so navigating into a different chat
 * (or back to the new-chat surface) never inherits the previous thread's open
 * explorer.
 */
export function WorkspaceFilesProvider({
  children,
}: WorkspaceFilesProviderProps) {
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

  const value = useMemo<WorkspaceFilesContextType>(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  );

  return (
    <WorkspaceFilesContext.Provider value={value}>
      {children}
    </WorkspaceFilesContext.Provider>
  );
}
