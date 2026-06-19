import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

/** A project's discussions, newest-activity first (any org member). */
export function useProjectDiscussions(
  organizationId: string,
  projectId: Id<'projects'>,
  category?: string,
) {
  return useConvexQuery(
    api.discussions.queries.listProjectDiscussions,
    { organizationId, projectId, ...(category ? { category } : {}) },
    { enabled: !!organizationId && !!projectId },
  );
}

/** One discussion's metadata (title, category, status, linked task). */
export function useDiscussion(organizationId: string, threadId: string | null) {
  return useConvexQuery(
    api.discussions.queries.getDiscussion,
    { organizationId, threadId: threadId ?? '' },
    { enabled: !!organizationId && !!threadId },
  );
}
