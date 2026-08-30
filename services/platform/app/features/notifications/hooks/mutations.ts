import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useMarkNotificationRead() {
  return useConvexMutation('notifications/mutations:markRead');
}

export function useMarkAllNotificationsRead() {
  return useConvexMutation('notifications/mutations:markAllRead');
}
