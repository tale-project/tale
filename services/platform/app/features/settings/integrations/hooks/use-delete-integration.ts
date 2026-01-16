import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

interface UseDeleteIntegrationParams {
  organizationId: string;
  integrationName: string;
}

export function useDeleteIntegration({ organizationId, integrationName }: UseDeleteIntegrationParams) {
  return useMutation(api.integrations.mutations.delete_integration.deleteIntegration).withOptimisticUpdate(
    (localStore) => {
      // Set the integration to null since it will be deleted
      localStore.setQuery(
        api.integrations.queries.get_by_name.getByName,
        { organizationId, name: integrationName },
        null
      );
    }
  );
}
