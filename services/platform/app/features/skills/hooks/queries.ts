import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';

/**
 * Read hooks for the skill library. Skills are org-config FILES (one
 * `SKILL.md` bundle per slug), so every read is a Convex ACTION behind
 * `useActionQuery` — cached under `configKeys` and invalidated by the write
 * hooks next door, like every file-backed config surface.
 */

/** Every skill the viewer may see, plus per-file read failures. */
export function useSkills(organizationId: string) {
  return useActionQuery(
    configKeys.list('skills', organizationId),
    'skills/actions:listSkills',
    { organizationId },
  );
}

/** One skill's full document (frontmatter subset + body + file list), or null. */
export function useSkill(organizationId: string, slug: string | null) {
  return useActionQuery(
    configKeys.detail('skills', organizationId, slug ?? ''),
    'skills/actions:getSkill',
    { organizationId, slug: slug ?? '' },
    { enabled: !!slug },
  );
}

/** One named bundle file's bytes (base64), for the asset viewer. */
export function useSkillAsset(
  organizationId: string,
  slug: string,
  path: string | null,
) {
  return useActionQuery(
    [...configKeys.detail('skills', organizationId, slug), 'asset', path ?? ''],
    'skills/actions:getSkillAsset',
    { organizationId, slug, path: path ?? '' },
    { enabled: !!path },
  );
}
