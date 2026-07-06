import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useNotificationPreferences(organizationId: string | undefined) {
  return useConvexQuery(
    api.collab.preferences.getNotificationPreferences,
    organizationId ? { organizationId } : 'skip',
  );
}
