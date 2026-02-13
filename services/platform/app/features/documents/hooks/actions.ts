import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useRetryRagIndexing() {
  return useConvexActionMutation(api.documents.actions.retryRagIndexing);
}

export function useImportOneDriveFiles() {
  return useConvexActionMutation(api.onedrive.actions.importFiles);
}
