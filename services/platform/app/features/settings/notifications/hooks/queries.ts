import { useBackendQuery } from '@/app/hooks/use-backend-query';

export function useNotificationPreferences(organizationId: string | undefined) {
  return useBackendQuery(
    'collab/preferences:getNotificationPreferences',
    organizationId ? { organizationId } : 'skip',
  );
}
