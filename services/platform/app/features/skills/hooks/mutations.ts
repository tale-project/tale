import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

function useInvalidateSkills() {
  const queryClient = useQueryClient();
  return (organizationId: string) =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'skills', organizationId],
    });
}

export function useCreateSkill() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.createSkill, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useUpdateSkill() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.updateSkill, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useDeleteSkill() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.deleteSkill, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useDuplicateSkill() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.duplicateSkill, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useWriteSkillAsset() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.writeSkillAsset, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useDeleteSkillAsset() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.deleteSkillAsset, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}
