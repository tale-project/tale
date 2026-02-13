import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Website } from '@/lib/collections/entities/websites';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

export function useRescanWebsite() {
  return useConvexMutation(api.websites.mutations.rescanWebsite);
}

export function useCreateWebsite(collection: Collection<Website, string>) {
  return useCallback(
    async (args: {
      organizationId: string;
      domain: string;
      title?: string;
      description?: string;
      scanInterval: string;
    }) => {
      const tx = collection.insert(
        {
          _id: toId<'websites'>(`temp-${crypto.randomUUID()}`),
          _creationTime: 0,
          organizationId: args.organizationId,
          domain: args.domain,
          title: args.title,
          description: args.description,
          scanInterval: args.scanInterval,
        },
        { optimistic: false },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useDeleteWebsite(collection: Collection<Website, string>) {
  return useCallback(
    async (args: { websiteId: string }) => {
      const tx = collection.delete(args.websiteId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateWebsite(collection: Collection<Website, string>) {
  return useCallback(
    async (args: {
      websiteId: string;
      domain?: string;
      title?: string;
      description?: string;
      scanInterval?: string;
      status?: 'active' | 'inactive' | 'error';
    }) => {
      const tx = collection.update(args.websiteId, (draft) => {
        if (args.domain !== undefined) draft.domain = args.domain;
        if (args.title !== undefined) draft.title = args.title;
        if (args.description !== undefined)
          draft.description = args.description;
        if (args.scanInterval !== undefined)
          draft.scanInterval = args.scanInterval;
        if (args.status !== undefined) draft.status = args.status;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
