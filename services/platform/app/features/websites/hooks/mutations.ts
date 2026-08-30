import { useConvexAction } from '@/app/hooks/use-convex-action';

export function useCreateWebsite() {
  return useConvexAction('websites/actions:createWebsite');
}

export function useDeleteWebsite() {
  return useConvexAction('websites/actions:deleteWebsite');
}

export function useUpdateWebsite() {
  return useConvexAction('websites/actions:updateWebsite');
}

export function useSyncWebsiteStatuses() {
  return useConvexAction('websites/actions:syncStatuses');
}

export function useResumeScanning() {
  return useConvexAction('websites/actions:resumeScanning');
}
