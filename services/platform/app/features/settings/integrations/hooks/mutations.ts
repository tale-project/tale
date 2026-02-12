import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { EmailProvider } from '@/lib/collections/entities/email-providers';
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

export function useUpdateEmailProvider(
  collection: Collection<EmailProvider, string>,
) {
  return useCallback(
    async (args: { providerId: string; name: string }) => {
      const tx = collection.update(args.providerId, (draft) => {
        draft.name = args.name;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useDeleteEmailProvider(
  collection: Collection<EmailProvider, string>,
) {
  return useCallback(
    async (args: { providerId: string }) => {
      const tx = collection.delete(args.providerId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
