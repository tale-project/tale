import { useQueryClient } from '@tanstack/react-query';

import { configKeys } from '@/app/hooks/config-query-keys';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

function useInvalidateBranding() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: configKeys.type('branding') });
}

export function useSaveBranding() {
  const invalidate = useInvalidateBranding();
  return useConvexAction(api.branding.file_actions.saveBranding, {
    onSuccess: () => invalidate(),
  });
}

export function useSnapshotBrandingHistory() {
  return useConvexAction(api.branding.file_actions.snapshotToHistory);
}

export function useSaveImage() {
  const invalidate = useInvalidateBranding();
  return useConvexAction(api.branding.file_actions.saveImage, {
    onSuccess: () => invalidate(),
  });
}

export function useDeleteImage() {
  const invalidate = useInvalidateBranding();
  return useConvexAction(api.branding.file_actions.deleteImage, {
    onSuccess: () => invalidate(),
  });
}
