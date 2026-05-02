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
  | 'markdown';

interface CanvasState {
  isCanvasOpen: boolean;
  artifactId?: Id<'artifacts'>;
}

interface CanvasContextType extends CanvasState {
  openCanvas: (artifactId: Id<'artifacts'>) => void;
  closeCanvas: () => void;
  resetCanvas: () => void;
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
};

export function CanvasProvider({ children }: CanvasProviderProps) {
  const [state, setState] = useState(INITIAL_STATE);

  const openCanvas = useCallback((artifactId: Id<'artifacts'>) => {
    setState({
      isCanvasOpen: true,
      artifactId,
    });
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

  const value = useMemo(
    () => ({
      ...state,
      openCanvas,
      closeCanvas,
      resetCanvas,
    }),
    [state, openCanvas, closeCanvas, resetCanvas],
  );

  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  );
}
