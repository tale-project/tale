'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

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
  const [state, setState] = useState(INITIAL_STATE);

  const openWorkspace = useCallback((path?: string) => {
    setState((prev) => ({
      isOpen: true,
      activeFilePath: path ?? prev.activeFilePath,
    }));
  }, []);

  const closeWorkspace = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const resetWorkspace = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const setActiveFilePath = useCallback((path: string | null) => {
    setState((prev) => ({ ...prev, activeFilePath: path }));
  }, []);

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
