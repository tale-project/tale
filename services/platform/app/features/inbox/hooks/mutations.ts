import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useMarkNotificationRead() {
  return useBackendMutation('collab/notifications:markNotificationRead');
}

export function useMarkAllNotificationsRead() {
  return useBackendMutation('collab/notifications:markAllNotificationsRead');
}
