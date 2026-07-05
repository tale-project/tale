import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export type NotificationsFilter = 'all' | 'unread';

/**
 * Return-loop summary for the current user: unread actionable count, tasks
 * waiting on me, and pending reviews routed to me. Powers the board
 * "Waiting on me" filter; scope to a project with `projectId`.
 */
export function useMyAttentionSummary(
  organizationId: string | undefined,
  projectId?: Id<'projects'>,
) {
  return useConvexQuery(
    api.collab.attention.getMyAttentionSummary,
    organizationId
      ? { organizationId, ...(projectId ? { projectId } : {}) }
      : 'skip',
  );
}

// The Unread/All filter is applied client-side (see `NotificationListPanel`),
// so it is intentionally NOT a query argument — toggling it must not change the
// query key, or pagination resets to `LoadingFirstPage` and the skeleton flashes.
//
// Cached pagination so reopening the panel (the popover unmounts the list on
// close) serves the previous results instantly and revalidates in the
// background, instead of flashing the first-load skeleton on every open.
export function useNotificationsList(organizationId: string) {
  return useCachedPaginatedQuery(
    api.notifications.queries.list,
    { organizationId },
    { initialNumItems: 25 },
  );
}

export function useNotificationsUnreadCount(organizationId: string) {
  return useConvexQuery(api.notifications.queries.unreadCount, {
    organizationId,
  });
}
