import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import type {
  ConversationWithMessages,
  Message,
} from '@/app/(app)/dashboard/[id]/conversations/types';
import { useState } from 'react';

export function useConversationMessages(conversationId: string | null) {
  const [localMessages, setLocalMessages] = useState<Message[]>([]);

  // Use Convex useQuery hook
  const conversation = useQuery(
    api.conversations.getConversationWithMessages,
    conversationId
      ? { conversationId: conversationId as Id<'conversations'> }
      : 'skip',
  );

  const messages = conversation?.messages || localMessages;
  const loading = conversation === undefined;
  const error = conversation === null ? 'Conversation not found' : null;

  const addMessage = (message: Message) => {
    setLocalMessages((prev) => [...prev, message]);
  };

  return {
    messages,
    conversation: conversation as ConversationWithMessages | null,
    loading,
    error,
    addMessage,
    // updateConversation is removed since Convex handles updates reactively
  };
}
