import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteWebsite(organizationId: string) {
  return useMutation(api.mutations.websites.deleteWebsite).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.websites.queries.getAllWebsites, {
        organizationId,
      });

      if (current !== undefined) {
        const updated = current.filter(
          (website) => website._id !== args.websiteId,
        );
        localStore.setQuery(
          api.websites.queries.getAllWebsites,
          { organizationId },
          updated,
        );
      }
    },
  );
}
