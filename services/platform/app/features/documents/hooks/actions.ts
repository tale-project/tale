import { useBackendAction } from '@/app/hooks/use-backend-action';

export function useRetryRagIndexing() {
  return useBackendAction('documents/actions:retryRagIndexing');
}

// The import dialogs report a failed import in their own toast, under the
// import's title; the hook's default toast would report the same failure a
// second time.
export function useImportOneDriveFiles() {
  return useBackendAction('onedrive/actions:importFiles', {
    errorToast: false,
  });
}

export function useImportGoogleDriveFiles() {
  return useBackendAction('google_drive/actions:importFiles', {
    errorToast: false,
  });
}
