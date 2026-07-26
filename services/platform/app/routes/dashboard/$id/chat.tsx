import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

/**
 * The chat section. The screen itself is rendered by the child routes — the
 * index for a fresh conversation, `$threadId` for an open one — so both share
 * one URL space and one set of metadata.
 */
export const Route = createFileRoute('/dashboard/$id/chat')({
  head: () => ({
    meta: seo('chat'),
  }),
  // Warm the surface's org-wide reads WITHOUT blocking the transition. The
  // chat seam subscribes to raw watches on the same Convex client React Query
  // rides, so a prefetched query answers the seam's first snapshot
  // synchronously — and React Query keeps the subscription live for its
  // gcTime after unmount, so re-entering chat stays warm. The projects args
  // must stay exactly the seam's `{ organizationId }`: the projects page
  // prefetches with `includeArchived`, which is a different query identity
  // that the seam's watch would miss.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.chat.threads.listThreads, { organizationId: params.id }),
    );
    void context.queryClient.prefetchQuery(
      convexQuery(api.projects.queries.listProjects, {
        organizationId: params.id,
      }),
    );
    // The sticky model pick: warm so the composer seeds its model on first
    // paint instead of one round-trip later.
    void context.queryClient.prefetchQuery(
      convexQuery(api.user_preferences.queries.getMyPreferences, {
        organizationId: params.id,
      }),
    );
  },
  component: () => <Outlet />,
});
