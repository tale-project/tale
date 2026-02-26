'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

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
  /** Count of user messages at send time — used to detect when the real message arrives. */
  userMessageBaseline: number;
}

export interface SelectedAgent {
  _id: string;
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
  const [isPending, setIsPending] = useState(false);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] =
    usePersistedState<SelectedAgent | null>(
      `selected-agent-${organizationId}`,
      null,
    );

  const clearChatState = useCallback(() => {
    setIsPending(false);
    setPendingThreadId(null);
    setPendingMessage(null);
  }, []);

  return (
    <ChatLayoutContext.Provider
      value={{
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
      }}
    >
      {children}
    </ChatLayoutContext.Provider>
  );
}
