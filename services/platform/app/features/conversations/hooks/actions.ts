import { useBackendAction } from '@/app/hooks/use-backend-action';

/** The message editor toasts a failed improvement itself, with the reason
 * (no provider set up, or the door's own sentence), so the default toast
 * would only repeat it. */
export function useImproveMessage() {
  return useBackendAction('conversations/actions:improveMessage', {
    errorToast: false,
  });
}
