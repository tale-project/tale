'use client';

import type { Conversation } from '../types';
import { Conversations } from './conversations';
import type { Preloaded } from 'convex/react';
import type { api } from '@/convex/_generated/api';

interface ConversationsWrapperProps {
  status?: Conversation['status'];
  preloadedConversations: Preloaded<
    typeof api.conversations.getConversationsPage
  >;
  preloadedEmailProviders: Preloaded<typeof api.email_providers.list>;
}

export function ConversationsWrapper({
  status,
  preloadedConversations,
  preloadedEmailProviders,
}: ConversationsWrapperProps) {
  return (
    <Conversations
      status={status}
      preloadedConversations={preloadedConversations}
      preloadedEmailProviders={preloadedEmailProviders}
    />
  );
}
