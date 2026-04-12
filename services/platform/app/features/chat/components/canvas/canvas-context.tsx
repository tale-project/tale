'use client';

import { useMutation } from 'convex/react';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { replaceCodeBlock } from '../../utils/replace-code-block';

export type CanvasContentType =
  | 'code'
  | 'html'
  | 'mermaid'
  | 'svg'
  | 'markdown';

export interface CanvasSource {
  messageId: string;
  messageContent: string;
  threadId?: string;
}

interface CanvasState {
  isCanvasOpen: boolean;
  canvasContent: string;
  canvasType: CanvasContentType;
  canvasTitle: string;
  canvasLanguage?: string;
  originalCanvasContent: string;
  source?: CanvasSource;
}

interface CanvasContextType extends CanvasState {
  openCanvas: (
    content: string,
    type: CanvasContentType,
    title: string,
    language?: string,
    source?: CanvasSource,
  ) => void;
  closeCanvas: () => void;
  updateCanvasContent: (content: string) => void;
  applyCanvasContent: () => Promise<void>;
  isDirty: boolean;
  canApply: boolean;
  isApplying: boolean;
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
  canvasContent: '',
  canvasType: 'code',
  canvasTitle: '',
  canvasLanguage: undefined,
  originalCanvasContent: '',
  source: undefined,
};

export function CanvasProvider({ children }: CanvasProviderProps) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const [state, setState] = useState(INITIAL_STATE);
  const [isApplying, setIsApplying] = useState(false);
  const updateMessage = useMutation(api.threads.mutations.updateMessageContent);

  const isDirty = state.canvasContent !== state.originalCanvasContent;
  const canApply = isDirty && !!state.source?.messageId;

  const openCanvas = useCallback(
    (
      content: string,
      type: CanvasContentType,
      title: string,
      language?: string,
      source?: CanvasSource,
    ) => {
      setState({
        isCanvasOpen: true,
        canvasContent: content,
        canvasType: type,
        canvasTitle: title,
        canvasLanguage: language,
        originalCanvasContent: content,
        source,
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

  const applyCanvasContent = useCallback(async () => {
    if (!state.source?.messageId || !state.source.messageContent) return;
    if (state.canvasContent === state.originalCanvasContent) return;

    setIsApplying(true);
    try {
      const { markdown: updatedMarkdown, replaced } = replaceCodeBlock(
        state.source.messageContent,
        state.originalCanvasContent,
        state.canvasContent,
      );

      if (!replaced) {
        toast({ title: t('canvas.applyFailed'), variant: 'destructive' });
        return;
      }

      await updateMessage({
        messageId: state.source.messageId,
        content: updatedMarkdown,
      });

      // Only update state on success
      setState((prev) => ({
        ...prev,
        originalCanvasContent: prev.canvasContent,
        source: prev.source
          ? { ...prev.source, messageContent: updatedMarkdown }
          : undefined,
      }));

      toast({ title: t('canvas.applied'), variant: 'success' });
    } catch (err) {
      console.error('Failed to apply canvas content:', err);
      toast({ title: t('canvas.applyFailed'), variant: 'destructive' });
    } finally {
      setIsApplying(false);
    }
  }, [state, updateMessage, t, toast]);

  const value = useMemo(
    () => ({
      ...state,
      openCanvas,
      closeCanvas,
      updateCanvasContent,
      applyCanvasContent,
      isDirty,
      canApply,
      isApplying,
    }),
    [
      state,
      openCanvas,
      closeCanvas,
      updateCanvasContent,
      applyCanvasContent,
      isDirty,
      canApply,
      isApplying,
    ],
  );

  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  );
}
