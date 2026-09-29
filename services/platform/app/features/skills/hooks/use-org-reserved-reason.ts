import { useT } from '@/lib/i18n/client';

import { useSkillPublishing } from './queries';

/**
 * Why the Organization audience is withheld from this viewer — the
 * organization reserves sharing a skill with everyone and the viewer may not
 * publish — or `undefined` when it is not. Also `undefined` while the
 * answer loads: the server decides every write either way.
 */
export function useOrgReservedReason(
  organizationId: string,
): string | undefined {
  const { t } = useT('skills');
  const publishing = useSkillPublishing(organizationId);
  if (publishing === undefined || publishing.allowed) return undefined;
  return publishing.mode === 'editors'
    ? t('publishing.reserved.editors')
    : t('publishing.reserved.admins');
}
