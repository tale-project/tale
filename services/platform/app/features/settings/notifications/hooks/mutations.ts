import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useSetNotificationPreferences() {
  // The preferences page toasts a failed toggle itself, with the reason.
  return useBackendMutation('collab/preferences:setNotificationPreferences', {
    errorToast: false,
  });
}
