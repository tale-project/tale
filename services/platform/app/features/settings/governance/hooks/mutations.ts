import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpsertGovernancePolicy() {
  return useConvexMutation(api.governance.mutations.upsertPolicy);
}
