import { useBackendAction } from '@/app/hooks/use-backend-action';

// The status badge and the row menu toast a failed retry themselves, with
// the reason; the default toast would report it a second time.
export function useRetryRagIndexing() {
  return useBackendAction('documents/actions:retryRagIndexing', {
    errorToast: false,
  });
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
