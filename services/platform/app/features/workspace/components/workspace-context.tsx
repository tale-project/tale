'use client';

import { useMatch } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import { usePersistedState } from '@/app/hooks/use-persisted-state';

interface WorkspaceState {
  isOpen: boolean;
  /** Path inside the active thread, or null = use the first listed file. */
  activeFilePath: string | null;
}

interface WorkspaceContextType extends WorkspaceState {
  openWorkspace: (path?: string) => void;
  closeWorkspace: () => void;
  resetWorkspace: () => void;
  setActiveFilePath: (path: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

export function useWorkspaceOptional() {
  return useContext(WorkspaceContext);
}

const INITIAL_STATE: WorkspaceState = {
  isOpen: false,
  activeFilePath: null,
};

interface WorkspaceProviderProps {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  // Persist the canvas open/active-file state PER CHAT so reopening a thread
  // restores whether its canvas was open. `usePersistedState` re-reads the new
  // key's value when `threadId` changes, so switching chats restores each
  // thread's own state. New chats (no threadId) share a transient slot that
  // `resetWorkspace` clears on thread→new transitions.
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;
  const [state, setState, clearState] = usePersistedState(
    threadId
      ? `tale.platform.chat.${threadId}.canvas`
      : 'tale.platform.chat.new.canvas',
    INITIAL_STATE,
  );

  const openWorkspace = useCallback(
    (path?: string) => {
      setState((prev) => ({
        isOpen: true,
        activeFilePath: path ?? prev.activeFilePath,
      }));
    },
    [setState],
  );

  const closeWorkspace = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, [setState]);

  const resetWorkspace = useCallback(() => {
    clearState();
  }, [clearState]);

  const setActiveFilePath = useCallback(
    (path: string | null) => {
      setState((prev) => ({ ...prev, activeFilePath: path }));
    },
    [setState],
  );

  const value = useMemo(
    () => ({
      ...state,
      openWorkspace,
      closeWorkspace,
      resetWorkspace,
      setActiveFilePath,
    }),
    [state, openWorkspace, closeWorkspace, resetWorkspace, setActiveFilePath],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
