import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useMyNotifications(
  organizationId: string,
  options?: { unreadOnly?: boolean },
) {
  const { data, isLoading } = useConvexQuery(
    api.collab.notifications.listMyNotifications,
    { organizationId, unreadOnly: options?.unreadOnly },
  );
  return { notifications: data ?? [], isLoading };
}

export function useUnreadNotificationCount(organizationId: string) {
  const { data } = useConvexQuery(api.collab.notifications.myUnreadCount, {
    organizationId,
  });
  return data ?? 0;
}
