import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useSetNotificationPreferences() {
  return useBackendMutation('collab/preferences:setNotificationPreferences');
}
