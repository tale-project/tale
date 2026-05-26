import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

function useInvalidateSkills() {
  const queryClient = useQueryClient();
  return (organizationId: string) =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'skills', organizationId],
    });
}

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useUploadSkillBundle() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.uploadSkillBundle, {
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
