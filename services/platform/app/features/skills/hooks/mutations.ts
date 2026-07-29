import { useQueryClient } from '@tanstack/react-query';

import { invalidateComposerCapabilitiesCache } from '@/app/features/chat/data/chat-backend';
import { configKeys } from '@/app/hooks/config-query-keys';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/**
 * Every write busts both caches a skill feeds: the library's own
 * react-query family AND the composer's session-level capability catalog,
 * so a fresh skill shows up in the equip menu and the `/` command without a
 * reload.
 */
function useInvalidateSkills(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    invalidateComposerCapabilitiesCache(organizationId);
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
export function useSaveSkill(organizationId: string) {
  const invalidate = useInvalidateSkills(organizationId);
  return useConvexAction(api.skills.actions.saveSkill, {
    onSuccess: () => invalidate(),
  });
}

/** Delete a skill's whole bundle (owner or org-admin; enforced server-side). */
export function useDeleteSkill(organizationId: string) {
  const invalidate = useInvalidateSkills(organizationId);
  return useConvexAction(api.skills.actions.deleteSkill, {
    onSuccess: () => invalidate(),
  });
}

/** Presign hop of the bundle upload (any member). */
export function useGenerateSkillUploadUrl() {
  return useConvexMutation(api.skills.upload_mutations.generateSkillUploadUrl);
}

/** Bind the POSTed blob to (org, user) — load-bearing before the action. */
export function useRecordSkillUploadIntent() {
  return useConvexMutation(api.skills.upload_mutations.recordSkillUploadIntent);
}

/** The final upload hop: parse, gate the replace, swap onto disk. */
export function useUploadSkillBundle(organizationId: string) {
  const invalidate = useInvalidateSkills(organizationId);
  return useConvexAction(api.skills.actions.uploadSkillBundle, {
    onSuccess: () => invalidate(),
  });
}
