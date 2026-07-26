import { useQueryClient } from '@tanstack/react-query';

import { configKeys } from '@/app/hooks/config-query-keys';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

function useInvalidateSkills() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: configKeys.type('skills') });
}

/** Delete a skill's whole bundle (owner or org-admin; enforced server-side). */
export function useDeleteSkill() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.actions.deleteSkill, {
    onSuccess: () => invalidate(),
  });
}
