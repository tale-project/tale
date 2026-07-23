import { useQueryClient } from '@tanstack/react-query';

import { configKeys } from '@/app/hooks/config-query-keys';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

function useInvalidateSkills() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: configKeys.type('skills') });
}

/**
 * Upsert a skill keyed by slug. Omitted optional fields mean "leave as-is" —
 * the server merges over the on-disk `SKILL.md`, so a partial save never
 * blanks frontmatter the editor doesn't carry.
 */
export function useSaveSkill() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.actions.saveSkill, {
    onSuccess: () => invalidate(),
  });
}

/** Delete a skill's whole bundle (owner or org-admin; enforced server-side). */
export function useDeleteSkill() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.actions.deleteSkill, {
    onSuccess: () => invalidate(),
  });
}
