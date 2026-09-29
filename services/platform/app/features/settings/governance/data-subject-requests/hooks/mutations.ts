import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

// Each data-subject-request dialog toasts its own failure, read through
// `mapDsrError` (a known refusal by its house sentence, else the door's own
// words); the default toast would report it a second time.

export function useRequestErasure() {
  return useBackendMutation('governance/erasure:requestErasure', {
    errorToast: false,
  });
}

export function useRetryErasureRequest() {
  return useBackendMutation('governance/erasure:retryErasureRequest', {
    errorToast: false,
  });
}

export function useExtendErasureDeadline() {
  return useBackendMutation('governance/erasure:extendErasureDeadline', {
    errorToast: false,
  });
}

export function useCancelErasureRequest() {
  return useBackendMutation('governance/erasure:cancelErasureRequest', {
    errorToast: false,
  });
}
