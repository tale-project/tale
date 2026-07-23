import { createFileRoute } from '@tanstack/react-router';

import { ChatSurface } from '@/app/features/chat/components/chat-surface';

export const Route = createFileRoute('/dashboard/$id/chat/$threadId')({
  component: ChatThreadRoute,
});

/** One open conversation. */
function ChatThreadRoute() {
  const { id, threadId } = Route.useParams();
  return <ChatSurface organizationId={id} threadId={threadId} />;
}
