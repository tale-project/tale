import { useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';
import type { EmailProviderDoc } from '@/convex/model/email_providers/types';

export function useDeleteEmailProvider() {
  const params = useParams();
  const organizationId = params?.id as string;

  return useMutation(api.email_providers.deleteProvider).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.email_providers.list, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.email_providers.list,
          { organizationId },
          current.filter((provider: EmailProviderDoc) => provider._id !== args.providerId)
        );
      }
    }
  );
}
