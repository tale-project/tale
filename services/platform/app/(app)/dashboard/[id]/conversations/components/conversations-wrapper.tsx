import { Suspense } from 'react';
import type { Conversation } from '../types';
import Conversations from './conversations';
import { Loader2Icon } from 'lucide-react';

interface ConversationsWrapperProps {
  conversations?: Conversation[];
  status?: Conversation['status'];
}

function ConversationsLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-muted-foreground flex items-center">
        <Loader2Icon className="size-4 mr-2 animate-spin" />
        Loading conversations
      </div>
    </div>
  );
}

export default function ConversationsWrapper({
  conversations,
  status,
}: ConversationsWrapperProps) {
  return (
    <Suspense fallback={<ConversationsLoader />}>
      <Conversations initialConversations={conversations} status={status} />
    </Suspense>
  );
}
