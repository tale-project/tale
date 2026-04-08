'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

export type CanvasContentType =
  | 'code'
  | 'html'
  | 'mermaid'
  | 'svg'
  | 'markdown';

interface CanvasState {
  isCanvasOpen: boolean;
  canvasContent: string;
  canvasType: CanvasContentType;
  canvasTitle: string;
  canvasLanguage?: string;
}

interface CanvasContextType extends CanvasState {
  openCanvas: (
    content: string,
    type: CanvasContentType,
    title: string,
    language?: string,
  ) => void;
  closeCanvas: () => void;
  updateCanvasContent: (content: string) => void;
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

export function CanvasProvider({ children }: CanvasProviderProps) {
  const [state, setState] = useState<CanvasState>({
    isCanvasOpen: false,
    canvasContent: '',
    canvasType: 'code',
    canvasTitle: '',
    canvasLanguage: undefined,
  });

  const openCanvas = useCallback(
    (
      content: string,
      type: CanvasContentType,
      title: string,
      language?: string,
    ) => {
      setState({
        isCanvasOpen: true,
        canvasContent: content,
        canvasType: type,
        canvasTitle: title,
        canvasLanguage: language,
      });
    },
    [],
  );

  const closeCanvas = useCallback(() => {
    setState((prev) => ({ ...prev, isCanvasOpen: false }));
  }, []);

  const updateCanvasContent = useCallback((content: string) => {
    setState((prev) => ({ ...prev, canvasContent: content }));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      openCanvas,
      closeCanvas,
      updateCanvasContent,
    }),
    [state, openCanvas, closeCanvas, updateCanvasContent],
  );

  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  );
}
