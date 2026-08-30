import { createFileRoute } from '@tanstack/react-router';

import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';

/**
 * One open conversation. The surface itself is rendered by the parent layout
 * route (navigating between threads and the index only changes its props);
 * this route contributes the warm-up loader.
 */
export const Route = createFileRoute('/dashboard/$id/chat/$threadId')({
  // Warm the thread's messages without blocking the transition — the seam
  // reads the same Convex client, so its first snapshot answers warm. The
  // router preloads on hover intent, so pointing at a thread in the list
  // usually has its conversation ready before the click.
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(context.queryClient, 'chat/messages:listMessages', {
      organizationId: params.id,
      threadId: params.threadId,
    });
  },
  component: () => null,
});
