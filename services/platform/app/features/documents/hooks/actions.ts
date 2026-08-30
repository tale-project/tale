import { useConvexAction } from '@/app/hooks/use-convex-action';

export function useRetryRagIndexing() {
  return useConvexAction('documents/actions:retryRagIndexing');
}

export function useImportOneDriveFiles() {
  return useConvexAction('onedrive/actions:importFiles');
}

export function useImportGoogleDriveFiles() {
  return useConvexAction('google_drive/actions:importFiles');
}
