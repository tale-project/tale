'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

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
}

export interface SelectedAgent {
  type: 'builtin' | 'custom';
  _id: string;
  displayName: string;
}

interface ChatLayoutContextType {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
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
  children: ReactNode;
}

export function ChatLayoutProvider({ children }: ChatLayoutProviderProps) {
  const [isPending, setIsPending] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(
    null,
  );

  const clearChatState = useCallback(() => {
    setIsPending(false);
    setPendingMessage(null);
  }, []);

  return (
    <ChatLayoutContext.Provider
      value={{
        isPending,
        setIsPending,
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
