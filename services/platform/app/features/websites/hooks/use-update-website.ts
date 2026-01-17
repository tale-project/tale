import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateWebsite(organizationId: string) {
  return useMutation(api.mutations.websites.updateWebsite).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.queries.websites.getAllWebsites, {
        organizationId,
      });

      if (current !== undefined) {
        const updated = current.map((website) =>
          website._id === args.websiteId
            ? {
                ...website,
                ...(args.title !== undefined && { title: args.title }),
                ...(args.domain !== undefined && { domain: args.domain }),
              }
            : website,
        );
        localStore.setQuery(
          api.queries.websites.getAllWebsites,
          { organizationId },
          updated,
        );
      }
    },
  );
}
