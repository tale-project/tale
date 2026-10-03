import { useBackendAction } from '@/app/hooks/use-backend-action';

export function useCreateWebsite() {
  // The create dialog reads the refusal and toasts it with its reason; the
  // hook's generic toast would only be replaced by it (one toast at a time).
  return useBackendAction('websites/actions:createWebsite', {
    errorToast: false,
  });
}

// A failed delete is reported by the one toast of the delete dialog or the
// table's bulk bar, and a failed edit by the edit dialog's own toast, each
// with the refusal's words; the default toast would report it again.
export function useDeleteWebsite() {
  return useBackendAction('websites/actions:deleteWebsite', {
    errorToast: false,
  });
}

export function useUpdateWebsite() {
  return useBackendAction('websites/actions:updateWebsite', {
    errorToast: false,
  });
}

export function useSyncWebsiteStatuses() {
  return useBackendAction('websites/actions:syncStatuses');
}

export function useResumeScanning() {
  return useBackendAction('websites/actions:resumeScanning');
}

export function useScanWebsiteNow(
  options?: Parameters<typeof useBackendAction<'websites/actions:scanNow'>>[1],
) {
  return useBackendAction('websites/actions:scanNow', options);
}
