import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useSetDefaultProvider(organizationId: string) {
  return useMutation(api.email_providers.mutations.set_default.setDefault).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.email_providers.queries.list.list, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.email_providers.queries.list.list,
          { organizationId },
          current.map((provider) => ({
            ...provider,
            isDefault: provider._id === args.providerId,
          }))
        );
      }
    }
  );
}
