import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';

/**
 * Paginated personal-notification stream (review requests, escalations, task
 * pings). Cursor-based so the inbox panel can "Load more" past the first page
 * instead of stopping at a fixed cap. The Unread/All filter is applied
 * client-side (see `NotificationListPanel`), so it is intentionally NOT a query
 * argument — toggling it must not change the query key (which would reset
 * pagination and re-flash the skeleton).
 */
export function useMyNotificationsList(organizationId: string) {
  return useCachedPaginatedQuery(
    'collab/notifications:listMyNotifications',
    { organizationId },
    { initialNumItems: 25 },
  );
}

export function useUnreadNotificationCount(organizationId: string) {
  const { data } = useConvexQuery('collab/notifications:myUnreadCount', {
    organizationId,
  });
  return data ?? 0;
}
