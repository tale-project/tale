import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/** Refresh the skills page's list after a bundle-changing action
 *  (create/upload/delete — or the builtin catalog sync). */
export function useInvalidateSkills() {
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

/** Create a skill — blank, or a copy of a built-in template bundle. */
export function useCreateSkill() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.createSkill, {
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

/** Save edits to a skill's SKILL.md (description + body) from the detail panel. */
export function useUpdateSkillMd() {
  const invalidate = useInvalidateSkills();
  return useConvexAction(api.skills.file_actions.updateSkillMd, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

/** Export an installed skill bundle as a downloadable zip (base64-encoded). */
export function useExportSkill() {
  return useConvexAction(api.skills.file_actions.exportSkill);
}
