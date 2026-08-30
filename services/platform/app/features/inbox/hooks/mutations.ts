import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useMarkNotificationRead() {
  return useConvexMutation('collab/notifications:markNotificationRead');
}

export function useMarkAllNotificationsRead() {
  return useConvexMutation('collab/notifications:markAllNotificationsRead');
}
