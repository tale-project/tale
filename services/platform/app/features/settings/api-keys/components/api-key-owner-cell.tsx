'use client';

import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import type { ApiKey } from '../types';

interface ApiKeyOwnerCellProps {
  apiKey: Pick<ApiKey, 'owner' | 'role' | 'createdBy'>;
  /** The signed-in member: a key made for them reads as theirs. */
  viewerUserId: string | undefined;
}

/**
 * Whose a key is, and — under it — what it acts as: the role of a team's, a
 * project's or the organization's key, who made a key for a member, or the
 * address of the member who holds their own key. The viewer's own key made
 * from a session bound to this organization works here alone, and says so
 * where their other own keys say only "You".
 */
export function ApiKeyOwnerCell({
  apiKey,
  viewerUserId,
}: ApiKeyOwnerCellProps) {
  const { t } = useT('settings');
  const { t: tRoles } = useT('roles');
  const { t: tCommon } = useT('common');
  const { owner } = apiKey;
  const ownHere =
    owner.kind === 'member' &&
    owner.userId === viewerUserId &&
    apiKey.createdBy?.userId === viewerUserId;

  let label: string;
  switch (owner.kind) {
    case 'user':
      label = t('apiKeys.owner.you');
      break;
    case 'personal':
      label = owner.name ?? owner.email ?? tCommon('formerMember');
      break;
    case 'member':
      label = ownHere
        ? t('apiKeys.owner.youHere')
        : owner.userId === viewerUserId
          ? t('apiKeys.owner.you')
          : (owner.name ?? owner.email ?? tCommon('formerMember'));
      break;
    case 'team':
      label =
        owner.teamName !== null
          ? t('apiKeys.owner.team', { name: owner.teamName })
          : t('apiKeys.owner.deletedTeam');
      break;
    case 'project':
      label =
        owner.projectName !== null
          ? t('apiKeys.owner.project', { name: owner.projectName })
          : t('apiKeys.owner.deletedProject');
      break;
    case 'organization':
      label = t('apiKeys.owner.organization');
      break;
  }

  const detail =
    apiKey.role !== null
      ? t('apiKeys.owner.actsAs', { role: tRoles(apiKey.role) })
      : owner.kind === 'member' && apiKey.createdBy !== null && !ownHere
        ? t('apiKeys.owner.madeBy', {
            name: apiKey.createdBy.name ?? tCommon('formerMember'),
          })
        : owner.kind === 'personal' &&
            owner.name !== null &&
            owner.email !== null
          ? owner.email
          : null;

  return (
    <div className="flex min-w-0 flex-col">
      <Text as="span" truncate className="text-sm" title={label}>
        {label}
      </Text>
      {detail !== null && (
        <Text
          as="span"
          variant="muted"
          truncate
          className="text-xs"
          title={detail}
        >
          {detail}
        </Text>
      )}
    </div>
  );
}
