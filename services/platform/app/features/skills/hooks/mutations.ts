import { useQueryClient } from '@tanstack/react-query';

import { configKeys } from '@/app/hooks/config-query-keys';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

/**
 * Every write busts the library's react-query family, so a fresh skill
 * shows up in every listing without a reload. (The chat composer no longer
 * lists skills — the chat page is model-selection only.)
 */
function useInvalidateSkills() {
  const queryClient = useQueryClient();
  return () => {
    return queryClient.invalidateQueries({
      queryKey: configKeys.type('skills'),
    });
  };
}

/**
 * Upsert a skill keyed by slug. Omitted optional fields mean "leave as-is" —
 * the server merges over the on-disk `SKILL.md`, so a partial save never
 * blanks frontmatter the editor doesn't carry.
 */
export function useSaveSkill() {
  const invalidate = useInvalidateSkills();
  return useBackendAction('skills/actions:saveSkill', {
    onSuccess: () => invalidate(),
  });
}

/** Delete a skill's whole bundle (owner or org-admin; enforced server-side). */
export function useDeleteSkill() {
  const invalidate = useInvalidateSkills();
  return useBackendAction('skills/actions:deleteSkill', {
    onSuccess: () => invalidate(),
  });
}

/** Presign hop of the bundle upload (any member). */
export function useGenerateSkillUploadUrl() {
  return useBackendMutation('skills/upload_mutations:generateSkillUploadUrl');
}

/** Bind the POSTed blob to (org, user) — load-bearing before the action. */
export function useRecordSkillUploadIntent() {
  return useBackendMutation('skills/upload_mutations:recordSkillUploadIntent');
}

/** The final upload hop: parse, gate the replace, swap onto disk. */
export function useUploadSkillBundle() {
  const invalidate = useInvalidateSkills();
  return useBackendAction('skills/actions:uploadSkillBundle', {
    onSuccess: () => invalidate(),
  });
}
