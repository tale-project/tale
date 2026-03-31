import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useSaveBranding() {
  return useConvexAction(api.branding.file_actions.saveBranding);
}

export function useSnapshotBrandingHistory() {
  return useConvexAction(api.branding.file_actions.snapshotToHistory);
}

export function useUpsertBrandingBindings() {
  return useConvexMutation(api.branding.mutations.upsertBrandingBindings);
}

export function useResetBranding() {
  return useConvexAction(api.branding.file_actions.resetBranding);
}

export function useClearBrandingBindings() {
  return useConvexMutation(api.branding.mutations.clearBrandingBindings);
}
