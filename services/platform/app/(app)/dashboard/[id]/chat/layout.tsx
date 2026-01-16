'use client';

import { useParams } from 'next/navigation';
import { createContext, useContext, useState, useCallback } from 'react';
import { ChatHeader } from './components/chat-header';
import { LayoutErrorBoundary } from '@/components/error-boundaries/boundaries/layout-error-boundary';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

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

interface ChatLayoutContextType {
  // Pending state - set immediately when user clicks send, before mutation completes
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
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
  const { t } = useT('common');
  const [isPending, setIsPending] = useState(false);

  const clearChatState = useCallback(() => {
    setIsPending(false);
  }, []);

  // Validate organizationId is a string
  if (!organizationId || Array.isArray(organizationId)) {
    throw new Error(t('errors.invalidOrganizationId'));
  }

  return (
    <ChatLayoutContext.Provider
      value={{
        isPending,
        setIsPending,
        clearChatState,
      }}
    >
      <div className="flex flex-col flex-1 min-h-0 h-full bg-background relative overflow-hidden">
        <ChatHeader organizationId={organizationId as string} />
        <LayoutErrorBoundary organizationId={organizationId as string}>
          {children}
        </LayoutErrorBoundary>
      </div>
    </ChatLayoutContext.Provider>
  );
}
