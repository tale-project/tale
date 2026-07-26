import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { ChatSurface } from '@/app/features/chat/components/chat-surface';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute('/dashboard/$id/chat/$threadId')({
  // Warm the thread's messages without blocking the transition — the seam
  // reads the same Convex client, so its first snapshot answers warm. The
  // router preloads on hover intent, so pointing at a thread in the list
  // usually has its conversation ready before the click.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.chat.messages.listMessages, {
        organizationId: params.id,
        threadId: params.threadId,
      }),
    );
  },
  component: ChatThreadRoute,
});

/** One open conversation. */
function ChatThreadRoute() {
  const { id, threadId } = Route.useParams();
  return <ChatSurface organizationId={id} threadId={threadId} />;
}
