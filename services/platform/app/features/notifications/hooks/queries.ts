import { useConvexPaginatedQuery } from '@/app/hooks/use-convex-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type NotificationsFilter = 'all' | 'unread';

// The Unread/All filter is applied client-side (see `NotificationListPanel`),
// so it is intentionally NOT a query argument — toggling it must not change the
// query key, or pagination resets to `LoadingFirstPage` and the skeleton flashes.
export function useNotificationsList(organizationId: string) {
  return useConvexPaginatedQuery(
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
