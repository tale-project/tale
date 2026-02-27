import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useCreateWebsite() {
  return useConvexAction(api.websites.actions.createWebsite);
}

export function useDeleteWebsite() {
  return useConvexAction(api.websites.actions.deleteWebsite);
}

export function useUpdateWebsite() {
  return useConvexAction(api.websites.actions.updateWebsite);
}

export function useSyncWebsiteStatuses() {
  return useConvexAction(api.websites.actions.syncStatuses);
}
