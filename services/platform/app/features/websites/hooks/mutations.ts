import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateWebsite() {
  return useConvexAction(api.websites.actions.createWebsite);
}

export function useDeleteWebsite() {
  return useConvexAction(api.websites.actions.deleteWebsite);
}

export function useRescanWebsite() {
  return useConvexAction(api.websites.actions.rescanWebsite);
}

export function useUpdateWebsite() {
  return useConvexMutation(api.websites.mutations.updateWebsite);
}

export function useSyncWebsiteStatuses() {
  return useConvexAction(api.websites.actions.syncStatuses);
}
