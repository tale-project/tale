import { useConvexQuery } from '@/app/hooks/use-convex-query';

export function useNotificationPreferences(organizationId: string | undefined) {
  return useConvexQuery(
    'collab/preferences:getNotificationPreferences',
    organizationId ? { organizationId } : 'skip',
  );
}
