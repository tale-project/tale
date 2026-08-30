import { useBackendAction } from '@/app/hooks/use-backend-action';

export function useCreateWebsite() {
  return useBackendAction('websites/actions:createWebsite');
}

export function useDeleteWebsite() {
  return useBackendAction('websites/actions:deleteWebsite');
}

export function useUpdateWebsite() {
  return useBackendAction('websites/actions:updateWebsite');
}

export function useSyncWebsiteStatuses() {
  return useBackendAction('websites/actions:syncStatuses');
}

export function useResumeScanning() {
  return useBackendAction('websites/actions:resumeScanning');
}
