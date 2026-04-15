import { useConvexPaginatedQuery } from '@/app/hooks/use-convex-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type NotificationsFilter = 'all' | 'unread';

export function useNotificationsList(
  organizationId: string,
  filter: NotificationsFilter = 'unread',
) {
  return useConvexPaginatedQuery(
    api.notifications.queries.list,
    { organizationId, filter },
    { initialNumItems: 25 },
  );
}

export function useNotificationsUnreadCount(organizationId: string) {
  return useConvexQuery(api.notifications.queries.unreadCount, {
    organizationId,
  });
}
