'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Id } from '@/convex/_generated/dataModel';

export type CanvasContentType =
  | 'code'
  | 'html'
  | 'mermaid'
  | 'svg'
  | 'markdown'
  // Runnable types — source code that executes in the server sandbox.
  // The CanvasRunnableCodeRenderer subscribes to the artifact row's
  // `run*` fields for live progress and final output file display.
  | 'python_runnable'
  | 'node_runnable';

interface CanvasState {
  isCanvasOpen: boolean;
  artifactId?: Id<'artifacts'>;
  /**
   * Which file inside the artifact's project the canvas is currently
   * showing. `null` means "use the entryFile" — resolution happens in
   * canvas-pane against the live artifact row so a renamed entry pointer
   * doesn't strand the selection.
   */
  activeFilePath: string | null;
}

interface CanvasContextType extends CanvasState {
  openCanvas: (artifactId: Id<'artifacts'>) => void;
  closeCanvas: () => void;
  resetCanvas: () => void;
  setActiveFilePath: (path: string | null) => void;
}

const CanvasContext = createContext<CanvasContextType | null>(null);

export function useCanvas() {
  const context = useContext(CanvasContext);
  if (!context) {
    throw new Error('useCanvas must be used within CanvasProvider');
  }
  return context;
}

export function useCanvasOptional() {
  return useContext(CanvasContext);
}

interface CanvasProviderProps {
  children: ReactNode;
}

const INITIAL_STATE: CanvasState = {
  isCanvasOpen: false,
  artifactId: undefined,
  activeFilePath: null,
};

export function CanvasProvider({ children }: CanvasProviderProps) {
  const [state, setState] = useState(INITIAL_STATE);

  const openCanvas = useCallback((artifactId: Id<'artifacts'>) => {
    setState((prev) => ({
      isCanvasOpen: true,
      artifactId,
      // Switching artifacts resets the active file; staying on the same
      // artifact preserves the user's file selection across re-opens.
      activeFilePath:
        prev.artifactId === artifactId ? prev.activeFilePath : null,
    }));
  }, []);

  const closeCanvas = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isCanvasOpen: false,
    }));
  }, []);

  const resetCanvas = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const setActiveFilePath = useCallback((path: string | null) => {
    setState((prev) => ({ ...prev, activeFilePath: path }));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      openCanvas,
      closeCanvas,
      resetCanvas,
      setActiveFilePath,
    }),
    [state, openCanvas, closeCanvas, resetCanvas, setActiveFilePath],
  );

  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  );
}
