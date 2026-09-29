import { useQueryClient } from '@tanstack/react-query';

import { configKeys } from '@/app/hooks/config-query-keys';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

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

/** The skill doors' refusal of a write shared with the whole organization
 * that the caller may not publish (the `skill_sharing` policy). */
const SKILL_PUBLISH_FORBIDDEN = 'SKILL_PUBLISH_FORBIDDEN';

/** Whether a failed skill write was refused for its organization-wide
 * audience. */
export function isSkillPublishRefusal(error: unknown): boolean {
  return backendErrorCode(error) === SKILL_PUBLISH_FORBIDDEN;
}

/**
 * The failure feedback of a write that can be refused for its
 * organization-wide audience. The form learns whether the viewer may publish
 * from the skills listing, and an admin can tighten the policy or revoke a
 * grant after it loaded: a refusal then names the reason in the viewer's
 * language and refreshes the listing, so the form stops offering the
 * Organization audience. Every other failure keeps the generic toast.
 */
function usePublishRefusalFeedback() {
  const { t } = useT('skills');
  const { t: tToast } = useT('toast');
  const invalidate = useInvalidateSkills();
  return {
    errorToast: {
      title: tToast('error.generic.title'),
      description: (error: Error) =>
        isSkillPublishRefusal(error) ? t('publishing.refused') : undefined,
    },
    onError: (error: Error) => {
      if (isSkillPublishRefusal(error)) void invalidate();
    },
  };
}

/**
 * Upsert a skill keyed by slug. Omitted optional fields mean "leave as-is" —
 * the server merges over the on-disk `SKILL.md`, so a partial save never
 * blanks frontmatter the editor doesn't carry.
 *
 * The detail pane toasts a failed save itself, naming a refused audience,
 * and passes `errorToast: false`: spread last, it wins over the refusal
 * feedback's toast, while the listing refresh still runs. The create pane
 * keeps this hook's toast.
 */
export function useSaveSkill(options?: { errorToast?: false }) {
  const invalidate = useInvalidateSkills();
  return useBackendAction('skills/actions:saveSkill', {
    onSuccess: () => invalidate(),
    ...usePublishRefusalFeedback(),
    ...options,
  });
}

/** Delete a skill's whole bundle (owner or org-admin; enforced server-side).
 * The detail pane toasts a failed delete itself, with the reason. */
export function useDeleteSkill() {
  const invalidate = useInvalidateSkills();
  return useBackendAction('skills/actions:deleteSkill', {
    errorToast: false,
    onSuccess: () => invalidate(),
  });
}

// The bundle upload's three hops below run through `useSkillBundleUpload`,
// whose one caller, the upload pane, toasts a failed upload with the reason:
// each hop keeps its own toast quiet.

/** Presign hop of the bundle upload (any member). */
export function useGenerateSkillUploadUrl() {
  return useBackendMutation('skills/upload_mutations:generateSkillUploadUrl', {
    errorToast: false,
  });
}

/** Bind the POSTed blob to (org, user) — load-bearing before the action. */
export function useRecordSkillUploadIntent() {
  return useBackendMutation('skills/upload_mutations:recordSkillUploadIntent', {
    errorToast: false,
  });
}

/** The final upload hop: parse, gate the replace, swap onto disk. */
export function useUploadSkillBundle() {
  const invalidate = useInvalidateSkills();
  // The upload pane's own toast names a refusal's reason; only the refresh
  // is shared.
  const { onError } = usePublishRefusalFeedback();
  return useBackendAction('skills/actions:uploadSkillBundle', {
    errorToast: false,
    onSuccess: () => invalidate(),
    onError,
  });
}
