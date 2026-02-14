import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useRescanWebsite() {
  return useConvexMutation(api.websites.mutations.rescanWebsite);
}

export function useCreateWebsite() {
  return useConvexOptimisticMutation(
    api.websites.mutations.createWebsite,
    api.websites.queries.listWebsites,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ domain, title, description, scanInterval }, { insert }) =>
        insert({
          _creationTime: Date.now(),
          domain,
          title,
          description,
          scanInterval,
          status: 'pending',
        }),
    },
  );
}

export function useDeleteWebsite() {
  return useConvexOptimisticMutation(
    api.websites.mutations.deleteWebsite,
    api.websites.queries.listWebsites,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ websiteId }, { remove }) => remove(websiteId),
    },
  );
}

export function useUpdateWebsite() {
  return useConvexOptimisticMutation(
    api.websites.mutations.updateWebsite,
    api.websites.queries.listWebsites,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ websiteId, ...changes }, { update }) =>
        update(websiteId, changes),
    },
  );
}
