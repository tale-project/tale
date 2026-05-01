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
  editBuffer?: string;
}

interface CanvasContextType extends CanvasState {
  openCanvas: (artifactId: Id<'artifacts'>) => void;
  closeCanvas: () => void;
  setEditBuffer: (content: string | undefined) => void;
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
  editBuffer: undefined,
};

export function CanvasProvider({ children }: CanvasProviderProps) {
  const [state, setState] = useState(INITIAL_STATE);

  const openCanvas = useCallback((artifactId: Id<'artifacts'>) => {
    setState({
      isCanvasOpen: true,
      artifactId,
      editBuffer: undefined,
    });
  }, []);

  const closeCanvas = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isCanvasOpen: false,
      editBuffer: undefined,
    }));
  }, []);

  const setEditBuffer = useCallback((content: string | undefined) => {
    setState((prev) => ({ ...prev, editBuffer: content }));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      openCanvas,
      closeCanvas,
      setEditBuffer,
    }),
    [state, openCanvas, closeCanvas, setEditBuffer],
  );

  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  );
}
