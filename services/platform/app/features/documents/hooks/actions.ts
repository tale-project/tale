import { useBackendAction } from '@/app/hooks/use-backend-action';

export function useRetryRagIndexing() {
  return useBackendAction('documents/actions:retryRagIndexing');
}

export function useImportOneDriveFiles() {
  return useBackendAction('onedrive/actions:importFiles');
}

export function useImportGoogleDriveFiles() {
  return useBackendAction('google_drive/actions:importFiles');
}
