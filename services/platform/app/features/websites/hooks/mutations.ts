import { useBackendAction } from '@/app/hooks/use-backend-action';

export function useCreateWebsite() {
  // The create dialog reads the refusal and toasts it with its reason; the
  // hook's generic toast would only be replaced by it (one toast at a time).
  return useBackendAction('websites/actions:createWebsite', {
    errorToast: false,
  });
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
