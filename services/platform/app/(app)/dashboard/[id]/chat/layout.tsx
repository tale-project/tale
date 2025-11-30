'use client';

import { useParams } from 'next/navigation';
import { createContext, useContext, useState, ReactNode } from 'react';
import ChatHeader from './components/chat-header';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';

interface ChatLayoutProps {
  children: React.ReactNode;
}

interface OptimisticMessage {
  content: string;
  threadId?: string;
}

interface ChatLayoutContextType {
  optimisticMessage: OptimisticMessage | null;
  setOptimisticMessage: (message: OptimisticMessage | null) => void;
  isOptimisticLoading: boolean;
  setIsOptimisticLoading: (loading: boolean) => void;
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
  const [isOptimisticLoading, setIsOptimisticLoading] = useState(false);

  // Validate organizationId is a string
  if (!organizationId || Array.isArray(organizationId)) {
    throw new Error('Invalid organization ID');
  }

  return (
    <ChatLayoutContext.Provider
      value={{
        optimisticMessage,
        setOptimisticMessage,
        isOptimisticLoading,
        setIsOptimisticLoading,
      }}
    >
      <div className="flex flex-col flex-[1_1_0] h-full bg-background relative">
        <ChatHeader organizationId={organizationId as string} />
        <ErrorBoundaryWithParams>{children}</ErrorBoundaryWithParams>
      </div>
    </ChatLayoutContext.Provider>
  );
}
