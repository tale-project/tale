import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Integration } from '@/lib/collections/entities/integrations';

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
