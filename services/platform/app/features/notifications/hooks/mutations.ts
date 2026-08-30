import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useMarkNotificationRead() {
  return useBackendMutation('notifications/mutations:markRead');
}

export function useMarkAllNotificationsRead() {
  return useBackendMutation('notifications/mutations:markAllRead');
}
