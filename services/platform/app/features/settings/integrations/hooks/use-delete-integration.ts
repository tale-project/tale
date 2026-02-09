import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export interface UseDeleteIntegrationParams {
  integrationName: string;
}

export function useDeleteIntegration({
  integrationName: _integrationName,
}: UseDeleteIntegrationParams) {
  return useMutation(api.integrations.mutations.deleteIntegration);
}
