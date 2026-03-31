import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useSaveBranding() {
  return useConvexAction(api.branding.file_actions.saveBranding);
}

export function useSnapshotBrandingHistory() {
  return useConvexAction(api.branding.file_actions.snapshotToHistory);
}

export function useSaveImage() {
  return useConvexAction(api.branding.file_actions.saveImage);
}

export function useDeleteImage() {
  return useConvexAction(api.branding.file_actions.deleteImage);
}
