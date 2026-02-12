import { createEmailProvidersCollection } from '@/lib/collections/entities/email-providers';
import { createIntegrationsCollection } from '@/lib/collections/entities/integrations';
import { useCollection } from '@/lib/collections/use-collection';

export function useIntegrationCollection(organizationId: string) {
  return useCollection(
    'integrations',
    createIntegrationsCollection,
    organizationId,
  );
}

export function useEmailProviderCollection(organizationId: string) {
  return useCollection(
    'email-providers',
    createEmailProvidersCollection,
    organizationId,
  );
}
