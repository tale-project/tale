import { createFileRoute } from '@tanstack/react-router';

import { ChatSurface } from '@/app/features/chat/components/chat-surface';

export const Route = createFileRoute('/dashboard/$id/chat/')({
  component: ChatIndexRoute,
});

/** A conversation that has not been started yet — no thread, full surface. */
function ChatIndexRoute() {
  const { id } = Route.useParams();
  return <ChatSurface organizationId={id} />;
}
