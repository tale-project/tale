import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useNotificationsList(organizationId: string) {
  return useConvexQuery(api.notifications.queries.list, {
    organizationId,
    paginationOpts: { cursor: null, numItems: 25 },
  });
}

export function useNotificationsUnreadCount(organizationId: string) {
  return useConvexQuery(api.notifications.queries.unreadCount, {
    organizationId,
  });
}
