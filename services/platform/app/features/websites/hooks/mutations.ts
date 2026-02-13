import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useRescanWebsite() {
  return useConvexMutation(api.websites.mutations.rescanWebsite);
}

export function useCreateWebsite() {
  const { mutateAsync } = useConvexMutation(
    api.websites.mutations.createWebsite,
  );
  return mutateAsync;
}

export function useDeleteWebsite() {
  const { mutateAsync } = useConvexMutation(
    api.websites.mutations.deleteWebsite,
  );
  return mutateAsync;
}

export function useUpdateWebsite() {
  const { mutateAsync } = useConvexMutation(
    api.websites.mutations.updateWebsite,
  );
  return mutateAsync;
}
