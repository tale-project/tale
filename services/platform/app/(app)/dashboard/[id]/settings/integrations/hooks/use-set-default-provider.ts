import { useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';

export function useSetDefaultProvider() {
  const params = useParams();
  const organizationId = params?.id as string;

  return useMutation(api.email_providers.setDefault).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.email_providers.list, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.email_providers.list,
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
