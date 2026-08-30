import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useRequestErasure() {
  return useBackendMutation('governance/erasure:requestErasure');
}

export function useRetryErasureRequest() {
  return useBackendMutation('governance/erasure:retryErasureRequest');
}

export function useExtendErasureDeadline() {
  return useBackendMutation('governance/erasure:extendErasureDeadline');
}

export function useCancelErasureRequest() {
  return useBackendMutation('governance/erasure:cancelErasureRequest');
}
