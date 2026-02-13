import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Integration } from '@/lib/collections/entities/integrations';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useUpdateIntegrationIcon() {
  return useConvexMutation(api.integrations.mutations.updateIcon);
}

export function useDeleteIntegration(
  collection: Collection<Integration, string>,
) {
  return useCallback(
    async (args: { integrationId: string }) => {
      const tx = collection.delete(args.integrationId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
