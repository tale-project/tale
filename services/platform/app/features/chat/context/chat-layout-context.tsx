'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ChatLayoutContextType {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  clearChatState: () => void;
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

  const clearChatState = useCallback(() => {
    setIsPending(false);
  }, []);

  return (
    <ChatLayoutContext.Provider
      value={{
        isPending,
        setIsPending,
        clearChatState,
      }}
    >
      {children}
    </ChatLayoutContext.Provider>
  );
}
