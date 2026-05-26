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

/**
 * Skill-specific presign mutation. Distinct from the generic
 * `files.mutations.generateUploadUrl` because the skills surface requires
 * the developer-settings capability check that the generic mutation
 * doesn't enforce.
 */
export function useGenerateSkillUploadUrl() {
  return useConvexMutation(api.skills.upload_mutations.generateSkillUploadUrl);
}

/**
 * Bind the freshly-POSTed `_storage` blob to the org + caller. Required
 * before `uploadSkillBundle` will trust the storageId — without an intent
 * row the action rejects with `STORAGE_NOT_OWNED`.
 */
export function useRecordSkillUploadIntent() {
  return useConvexMutation(api.skills.upload_mutations.recordSkillUploadIntent);
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
