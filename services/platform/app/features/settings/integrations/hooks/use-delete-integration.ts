import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export interface UseDeleteIntegrationParams {
  integrationName: string;
}

export function useDeleteIntegration({ integrationName }: UseDeleteIntegrationParams) {
  return useMutation(api.integrations.mutations.delete_integration.deleteIntegration);
}
