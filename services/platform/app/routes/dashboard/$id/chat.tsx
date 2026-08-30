import {
  createFileRoute,
  Outlet,
  useParams,
  useSearch,
} from '@tanstack/react-router';

import { ChatSurface } from '@/app/features/chat/components/chat-surface';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { seo } from '@/lib/utils/seo';

/**
 * The chat section. The surface is rendered HERE, on the layout route, and
 * reads the child params loosely: navigating between the index and
 * `$threadId` (the first send does exactly that) only changes props, so the
 * surface — composer text, subscriptions, transcript — survives instead of
 * remounting. The child routes contribute their loaders and search
 * validation and render nothing. The shared-snapshot child is the exception:
 * it is its own read-only screen, so the surface steps aside for it.
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
    prefetchAdaptedQuery(context.queryClient, 'chat/threads:listThreads', {
      organizationId: params.id,
    });
    prefetchAdaptedQuery(context.queryClient, 'projects/queries:listProjects', {
      organizationId: params.id,
    });
    // The sticky model pick: warm so the composer seeds its model on first
    // paint instead of one round-trip later.
    prefetchAdaptedQuery(
      context.queryClient,
      'user_preferences/queries:getMyPreferences',
      {
        organizationId: params.id,
      },
    );
  },
  component: ChatSectionRoute,
});

function ChatSectionRoute() {
  const { id } = Route.useParams();
  const childParams = useParams({ strict: false });
  const search = useSearch({ strict: false });

  // The shared-snapshot child owns its screen entirely.
  if (typeof childParams.shareToken === 'string') {
    return <Outlet />;
  }

  const threadId =
    typeof childParams.threadId === 'string' ? childParams.threadId : undefined;
  // Validated by the index route's `validateSearch`; read loosely here so the
  // layout needs no per-child coupling.
  const projectId =
    threadId === undefined &&
    typeof search.projectId === 'string' &&
    search.projectId !== ''
      ? search.projectId
      : undefined;
  // Explicit fresh composer (`?new=1` from the header / shortcut / empty
  // state). Project-linked new chats are also fresh — they must not bounce
  // into an unrelated last thread.
  const startFresh =
    threadId === undefined &&
    (projectId !== undefined ||
      search.new === true ||
      search.new === '1' ||
      search.new === 'true');

  return (
    <>
      <ChatSurface
        organizationId={id}
        {...(threadId !== undefined ? { threadId } : {})}
        {...(projectId !== undefined ? { projectId } : {})}
        startFresh={startFresh}
      />
      <Outlet />
    </>
  );
}
