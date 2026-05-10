import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useRequestErasure() {
  return useConvexMutation(api.governance.erasure.requestErasure);
}

export function useRetryErasureRequest() {
  return useConvexMutation(api.governance.erasure.retryErasureRequest);
}

export function useExtendErasureDeadline() {
  return useConvexMutation(api.governance.erasure.extendErasureDeadline);
}

export function useCancelErasureRequest() {
  return useConvexMutation(api.governance.erasure.cancelErasureRequest);
}
