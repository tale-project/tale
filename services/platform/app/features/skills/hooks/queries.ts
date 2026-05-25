import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

export function useListSkills(organizationId: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('skills', organizationId),
    api.skills.file_actions.listSkills,
    { organizationId },
  );
  return { skills: data, isLoading, error, refetch };
}

export function useReadSkill(organizationId: string, slug: string) {
  return useActionQuery(
    configKeys.detail('skills', organizationId, slug),
    api.skills.file_actions.readSkill,
    { organizationId, slug },
  );
}

export function useListSkillFiles(organizationId: string, slug: string) {
  return useActionQuery(
    ['config', 'skills', organizationId, slug, 'files'],
    api.skills.file_actions.listSkillFiles,
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

export function useFindAgentsBindingSkill(
  organizationId: string,
  skillSlug: string,
  options?: { enabled?: boolean },
) {
  // This query does a full readdir + parse of every agent JSON, so it
  // must be gated. The skill-delete dialog is mounted per row in the
  // table, so leaving it always-on caused N+1 (50 skills × 50 agents on
  // the listing render). Callers pass `enabled: open` to defer the
  // lookup until the dialog actually opens.
  return useActionQuery(
    ['config', 'skills', organizationId, skillSlug, 'related-agents'],
    api.skills.find_related_agents.findAgentsBindingSkill,
    { organizationId, skillSlug },
    { enabled: options?.enabled !== false },
  );
}
