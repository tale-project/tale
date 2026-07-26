import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

/**
 * Read hooks for the skill library. Skills are org-config FILES (one
 * `SKILL.md` bundle per slug), so both reads are Convex ACTIONS behind
 * `useActionQuery` — cached under `configKeys` and invalidated by the write
 * hooks next door, like every file-backed config surface (branding is the
 * template).
 */

/** Every skill the viewer may see, plus per-file read failures. */
export function useSkills(organizationId: string) {
  return useActionQuery(
    configKeys.list('skills', organizationId),
    api.skills.actions.listSkills,
    { organizationId },
  );
}

/** One skill's full document (frontmatter subset + body), or null. */
export function useSkill(organizationId: string, slug: string | null) {
  return useActionQuery(
    configKeys.detail('skills', organizationId, slug ?? ''),
    api.skills.actions.getSkill,
    { organizationId, slug: slug ?? '' },
    { enabled: !!slug },
  );
}

/** The bundle's file tree (paths + sizes; SKILL.md pinned out), or null. */
export function useSkillAssets(organizationId: string, slug: string | null) {
  return useActionQuery(
    configKeys.detail('skills', organizationId, `${slug ?? ''}/assets`),
    api.skills.actions.getSkillAssets,
    { organizationId, slug: slug ?? '' },
    { enabled: !!slug },
  );
}

/** One asset's bytes (base64 — the viewer decodes), null-gated on selection. */
export function useSkillAsset(
  organizationId: string,
  slug: string,
  assetPath: string | null,
) {
  return useActionQuery(
    configKeys.detail(
      'skills',
      organizationId,
      `${slug}/asset/${assetPath ?? ''}`,
    ),
    api.skills.actions.getSkillAsset,
    { organizationId, slug, assetPath: assetPath ?? '' },
    { enabled: assetPath !== null },
  );
}
