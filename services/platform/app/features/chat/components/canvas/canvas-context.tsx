'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
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
  originalContent: string;
  canvasType: CanvasContentType;
  canvasTitle: string;
  canvasLanguage?: string;
}

interface CanvasContextType extends CanvasState {
  isDirty: boolean;
  openCanvas: (
    content: string,
    type: CanvasContentType,
    title: string,
    language?: string,
  ) => void;
  closeCanvas: () => void;
  updateCanvasContent: (content: string) => void;
  registerOnApply: (
    callback: (content: string, language?: string) => void,
  ) => void;
  applyCanvasContent: () => void;
  resetDirtyState: () => void;
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
    originalContent: '',
    canvasType: 'code',
    canvasTitle: '',
    canvasLanguage: undefined,
  });

  const onApplyRef = useRef<
    ((content: string, language?: string) => void) | null
  >(null);

  const isDirty = state.canvasContent !== state.originalContent;

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
        originalContent: content,
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

  const registerOnApply = useCallback(
    (callback: (content: string, language?: string) => void) => {
      onApplyRef.current = callback;
    },
    [],
  );

  const applyCanvasContent = useCallback(() => {
    if (onApplyRef.current) {
      onApplyRef.current(state.canvasContent, state.canvasLanguage);
    }
    setState((prev) => ({
      ...prev,
      originalContent: prev.canvasContent,
    }));
  }, [state.canvasContent, state.canvasLanguage]);

  const resetDirtyState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      originalContent: prev.canvasContent,
    }));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      isDirty,
      openCanvas,
      closeCanvas,
      updateCanvasContent,
      registerOnApply,
      applyCanvasContent,
      resetDirtyState,
    }),
    [
      state,
      isDirty,
      openCanvas,
      closeCanvas,
      updateCanvasContent,
      registerOnApply,
      applyCanvasContent,
      resetDirtyState,
    ],
  );

  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  );
}
