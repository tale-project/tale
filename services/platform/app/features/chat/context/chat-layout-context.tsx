'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

import { useAuth } from '@/app/hooks/use-convex-auth';
import { usePersistedState } from '@/app/hooks/use-persisted-state';

interface PendingMessageAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface PendingMessage {
  content: string;
  threadId: string;
  attachments?: PendingMessageAttachment[];
  timestamp: Date;
  lastMessageKey?: string;
}

export interface SelectedAgent {
  name: string;
  displayName: string;
}

interface ChatLayoutContextType {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  pendingThreadId: string | null;
  setPendingThreadId: (threadId: string | null) => void;
  clearChatState: () => void;
  pendingMessage: PendingMessage | null;
  setPendingMessage: (message: PendingMessage | null) => void;
  isHistoryOpen: boolean;
  setIsHistoryOpen: (open: boolean) => void;
  selectedAgent: SelectedAgent | null;
  setSelectedAgent: (agent: SelectedAgent | null) => void;
  selectedModelOverrides: Record<string, string>;
  setSelectedModelOverride: (agentName: string, modelId: string | null) => void;
}

const ChatLayoutContext = createContext<ChatLayoutContextType | null>(null);

export function useChatLayout() {
  const context = useContext(ChatLayoutContext);
  if (!context) {
    throw new Error('useChatLayout must be used within ChatLayoutProvider');
  }
  return context;
}

interface ChatLayoutProviderProps {
  organizationId: string;
  children: ReactNode;
}

export function ChatLayoutProvider({
  organizationId,
  children,
}: ChatLayoutProviderProps) {
  const { user } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const agentKey = user?.userId
    ? `selected-agent-${user.userId}-${organizationId}`
    : `selected-agent-${organizationId}`;
  const [selectedAgent, setSelectedAgent] =
    usePersistedState<SelectedAgent | null>(agentKey, null);

  const modelOverridesKey = user?.userId
    ? `selected-models-${user.userId}-${organizationId}`
    : `selected-models-${organizationId}`;
  const [selectedModelOverrides, setSelectedModelOverrides] = usePersistedState<
    Record<string, string>
  >(modelOverridesKey, {});

  const setSelectedModelOverride = useCallback(
    (agentName: string, modelId: string | null) => {
      setSelectedModelOverrides((prev) => {
        if (modelId === null) {
          const { [agentName]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [agentName]: modelId };
      });
    },
    [setSelectedModelOverrides],
  );

  const clearChatState = useCallback(() => {
    setIsPending(false);
    setPendingThreadId(null);
    setPendingMessage(null);
  }, []);

  const value = useMemo(
    () => ({
      isPending,
      setIsPending,
      pendingThreadId,
      setPendingThreadId,
      clearChatState,
      pendingMessage,
      setPendingMessage,
      isHistoryOpen,
      setIsHistoryOpen,
      selectedAgent,
      setSelectedAgent,
      selectedModelOverrides,
      setSelectedModelOverride,
    }),
    [
      isPending,
      pendingThreadId,
      clearChatState,
      pendingMessage,
      isHistoryOpen,
      selectedAgent,
      setSelectedAgent,
      selectedModelOverrides,
      setSelectedModelOverride,
    ],
  );

  return (
    <ChatLayoutContext.Provider value={value}>
      {children}
    </ChatLayoutContext.Provider>
  );
}
