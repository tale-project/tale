'use client';

import { Suspense } from 'react';
import type { Conversation } from '../types';
import { Conversations } from './conversations';
import { ListSkeleton } from '@/components/skeletons/list-skeleton';
import type { Preloaded } from 'convex/react';
import type { api } from '@/convex/_generated/api';

interface ConversationsWrapperProps {
  status?: Conversation['status'];
  preloadedConversations: Preloaded<
    typeof api.conversations.getConversationsPage
  >;
  preloadedEmailProviders: Preloaded<typeof api.email_providers.list>;
}

/**
 * Skeleton for the conversations list that matches the actual layout.
 * Shows a list of conversation items with avatar, title, and preview.
 */
function ConversationsSkeleton() {
  return (
    <div className="px-4 py-6">
      <ListSkeleton
        items={10}
        itemProps={{
          showAvatar: true,
          showSecondary: true,
          showAction: true,
        }}
      />
    </div>
  );
}

export function ConversationsWrapper({
  status,
  preloadedConversations,
  preloadedEmailProviders,
}: ConversationsWrapperProps) {
  return (
    <Suspense fallback={<ConversationsSkeleton />}>
      <Conversations
        status={status}
        preloadedConversations={preloadedConversations}
        preloadedEmailProviders={preloadedEmailProviders}
      />
    </Suspense>
  );
}
