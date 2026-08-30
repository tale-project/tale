import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useRequestErasure() {
  return useConvexMutation('governance/erasure:requestErasure');
}

export function useRetryErasureRequest() {
  return useConvexMutation('governance/erasure:retryErasureRequest');
}

export function useExtendErasureDeadline() {
  return useConvexMutation('governance/erasure:extendErasureDeadline');
}

export function useCancelErasureRequest() {
  return useConvexMutation('governance/erasure:cancelErasureRequest');
}
