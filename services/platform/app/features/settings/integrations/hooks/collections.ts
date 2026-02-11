import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { EmailProvider } from '@/lib/collections/entities/email-providers';
import type { Integration } from '@/lib/collections/entities/integrations';

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

export function useIntegrations(collection: Collection<Integration, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ integration: collection })
      .select(({ integration }) => integration),
  );

  return {
    integrations: data,
    isLoading,
  };
}

export function useEmailProviders(
  collection: Collection<EmailProvider, string>,
) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ provider: collection }).select(({ provider }) => provider),
  );

  return {
    providers: data,
    isLoading,
  };
}

export type { EmailProvider, Integration };
