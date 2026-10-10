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
    // The branding form's `save` rethrows a failure as its own sentence for
    // the Save cluster's one toast, and the reset toasts its own: this
    // write's toast would report it a second time.
    errorToast: false,
    onSuccess: () => invalidate(),
  });
}

export function useSnapshotBrandingHistory() {
  return useBackendAction('branding/file_actions:snapshotToHistory');
}

/** An image upload field toasts a failed upload itself (too large, wrong
 * type, …) and passes `errorToast: false`; so does the logo's derived
 * favicon, which reports a failure itself and stays quiet when it was
 * refused because the branding changed since (`CONFIG_VERSION_CONFLICT`). */
export function useSaveImage(options?: { errorToast?: false }) {
  const invalidate = useInvalidateBranding();
  return useBackendAction('branding/file_actions:saveImage', {
    ...options,
    onSuccess: () => invalidate(),
  });
}

export function useDeleteImage() {
  const invalidate = useInvalidateBranding();
  return useBackendAction('branding/file_actions:deleteImage', {
    onSuccess: () => invalidate(),
  });
}
