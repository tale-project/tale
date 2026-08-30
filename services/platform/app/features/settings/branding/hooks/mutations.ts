import { useQueryClient } from '@tanstack/react-query';

import { configKeys } from '@/app/hooks/config-query-keys';
import { useBackendAction } from '@/app/hooks/use-backend-action';

function useInvalidateBranding() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: configKeys.type('branding') });
}

export function useSaveBranding() {
  const invalidate = useInvalidateBranding();
  return useBackendAction('branding/file_actions:saveBranding', {
    onSuccess: () => invalidate(),
  });
}

export function useSnapshotBrandingHistory() {
  return useBackendAction('branding/file_actions:snapshotToHistory');
}

export function useSaveImage() {
  const invalidate = useInvalidateBranding();
  return useBackendAction('branding/file_actions:saveImage', {
    onSuccess: () => invalidate(),
  });
}

export function useDeleteImage() {
  const invalidate = useInvalidateBranding();
  return useBackendAction('branding/file_actions:deleteImage', {
    onSuccess: () => invalidate(),
  });
}
