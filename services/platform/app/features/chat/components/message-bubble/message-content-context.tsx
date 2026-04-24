'use client';

import { createContext, useContext } from 'react';

interface MessageContentContextType {
  messageId: string;
  messageContent: string;
  threadId?: string;
  isStreaming?: boolean;
}

export const MessageContentContext =
  createContext<MessageContentContextType | null>(null);

export function useMessageContentOptional() {
  return useContext(MessageContentContext);
}
