import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useRescanWebsite() {
  return useConvexMutation(api.websites.mutations.rescanWebsite);
}

export function useCreateWebsite() {
  return useConvexMutation(api.websites.mutations.createWebsite);
}

export function useDeleteWebsite() {
  return useConvexMutation(api.websites.mutations.deleteWebsite);
}

export function useUpdateWebsite() {
  return useConvexMutation(api.websites.mutations.updateWebsite);
}
