import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteEmailProvider(organizationId: string) {
  return useMutation(api.email_providers.mutations.delete_provider.deleteProvider).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.email_providers.queries.list.list, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.email_providers.queries.list.list,
          { organizationId },
          current.filter((provider) => provider._id !== args.providerId)
        );
      }
    }
  );
}
