import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useRetryRagIndexing() {
  return useConvexAction(api.documents.actions.retryRagIndexing);
}

export function useImportOneDriveFiles() {
  return useConvexAction(api.onedrive.actions.importFiles);
}
