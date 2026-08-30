import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';

export type NotificationsFilter = 'all' | 'unread';

// The Unread/All filter is applied client-side (see `NotificationListPanel`),
// so it is intentionally NOT a query argument — toggling it must not change the
// query key, or pagination resets to `LoadingFirstPage` and the skeleton flashes.
//
// Cached pagination so reopening the panel (the popover unmounts the list on
// close) serves the previous results instantly and revalidates in the
// background, instead of flashing the first-load skeleton on every open.
export function useNotificationsList(organizationId: string) {
  return useCachedPaginatedQuery(
    'notifications/queries:list',
    { organizationId },
    { initialNumItems: 25 },
  );
}

export function useNotificationsUnreadCount(organizationId: string) {
  return useConvexQuery('notifications/queries:unreadCount', {
    organizationId,
  });
}
