import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { EmailProvider } from '@/lib/collections/entities/email-providers';
import type { Integration } from '@/lib/collections/entities/integrations';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

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

export function useSetDefaultProvider() {
  return useConvexMutation(api.email_providers.mutations.setDefault);
}

export function useCreateEmailProvider() {
  return useConvexAction(api.email_providers.actions.create);
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

export function useCreateIntegration() {
  return useConvexAction(api.integrations.actions.create);
}

export function useUpdateIntegration() {
  return useConvexAction(api.integrations.actions.update);
}

export function useCreateOAuth2Provider() {
  return useConvexAction(api.email_providers.actions.createOAuth2Provider);
}

export function useUpdateOAuth2Provider() {
  return useConvexAction(api.email_providers.actions.updateOAuth2Provider);
}

export function useUpsertSsoProvider() {
  return useConvexAction(api.sso_providers.actions.upsert);
}

export function useRemoveSsoProvider() {
  return useConvexAction(api.sso_providers.actions.remove);
}
