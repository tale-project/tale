import { useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';

interface UseDeleteIntegrationParams {
  integrationName: string;
}

export function useDeleteIntegration({ integrationName }: UseDeleteIntegrationParams) {
  const params = useParams();
  const organizationId = params?.id as string;

  return useMutation(api.integrations.deleteIntegration).withOptimisticUpdate(
    (localStore) => {
      // Set the integration to null since it will be deleted
      localStore.setQuery(
        api.integrations.getByName,
        { organizationId, name: integrationName },
        null
      );
    }
  );
}
