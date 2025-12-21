'use client';

import { useParams } from 'next/navigation';
import { createContext, useContext, useState, useCallback } from 'react';
import ChatHeader from './components/chat-header';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import type { Id } from '@/convex/_generated/dataModel';

interface ChatLayoutProps {
  children: React.ReactNode;
}

export interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
}

interface OptimisticMessage {
  content: string;
  threadId?: string;
  attachments?: FileAttachment[];
}

interface ChatLayoutContextType {
  // Optimistic user message shown while waiting for server confirmation
  optimisticMessage: OptimisticMessage | null;
  setOptimisticMessage: (message: OptimisticMessage | null) => void;
  // Current run ID for status polling - persists across navigation
  currentRunId: string | null;
  setCurrentRunId: (runId: string | null) => void;
  // Pending state - set immediately when user clicks send, before mutation completes
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  // Derived loading state - true when pending or have an active run
  isLoading: boolean;
  // Clear all chat state (called on completion/error)
  clearChatState: () => void;
}

const ChatLayoutContext = createContext<ChatLayoutContextType | null>(null);

export function useChatLayout() {
  const context = useContext(ChatLayoutContext);
  if (!context) {
    throw new Error('useChatLayout must be used within ChatLayout');
  }
  return context;
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  const { id: organizationId } = useParams();
  const [optimisticMessage, setOptimisticMessage] =
    useState<OptimisticMessage | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Derive loading state from pending or currentRunId
  // isPending = immediately after user clicks send
  // currentRunId = after mutation completes and we have a run ID
  const isLoading = isPending || currentRunId !== null;

  const clearChatState = useCallback(() => {
    setCurrentRunId(null);
    setOptimisticMessage(null);
    setIsPending(false);
  }, []);

  // Validate organizationId is a string
  if (!organizationId || Array.isArray(organizationId)) {
    throw new Error('Invalid organization ID');
  }

  return (
    <ChatLayoutContext.Provider
      value={{
        optimisticMessage,
        setOptimisticMessage,
        currentRunId,
        setCurrentRunId,
        isPending,
        setIsPending,
        isLoading,
        clearChatState,
      }}
    >
      <div className="flex flex-col flex-[1_1_0] h-full bg-background relative">
        <ChatHeader organizationId={organizationId as string} />
        <ErrorBoundaryWithParams>{children}</ErrorBoundaryWithParams>
      </div>
    </ChatLayoutContext.Provider>
  );
}
