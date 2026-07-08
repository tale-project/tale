import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { SkillListEntry } from '@/convex/skills/file_actions';

export type { SkillListEntry };

export function useListSkills(organizationId: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('skills', organizationId),
    api.skills.file_actions.listSkills,
    { organizationId },
  );
  return { skills: data, isLoading, error, refetch };
}

/**
 * The built-in skill catalog (`{ slug, name, description }` rows) — the
 * template list behind the "From template" create dialog.
 */
export function useListCatalogSkills(organizationId: string, enabled = true) {
  const { data, isLoading, error } = useActionQuery(
    ['config', 'skills', organizationId, 'catalog'],
    api.skills.file_actions.listCatalogSkills,
    { organizationId },
    { enabled },
  );
  return { templates: data ?? [], isLoading, error };
}

export function useReadSkill(organizationId: string, slug: string) {
  return useActionQuery(
    configKeys.detail('skills', organizationId, slug),
    api.skills.file_actions.readSkill,
    { organizationId, slug },
  );
}

export function useReadSkillAsset(
  organizationId: string,
  slug: string,
  assetPath: string | null,
) {
  return useActionQuery(
    ['config', 'skills', organizationId, slug, 'asset', assetPath ?? ''],
    api.skills.file_actions.readSkillAsset,
    { organizationId, slug, assetPath: assetPath ?? '' },
    { enabled: assetPath !== null && assetPath.length > 0 },
  );
}

export function useGetSkillAuditHistory(organizationId: string, slug: string) {
  return useActionQuery(
    ['config', 'skills', organizationId, slug, 'audit-history'],
    api.skills.get_skill_audit_history.getSkillAuditHistory,
    { organizationId, slug },
  );
}
