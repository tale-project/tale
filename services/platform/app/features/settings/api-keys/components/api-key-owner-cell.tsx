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
 * project's or the organization's key, or who made a key for a member.
 */
export function ApiKeyOwnerCell({
  apiKey,
  viewerUserId,
}: ApiKeyOwnerCellProps) {
  const { t } = useT('settings');
  const { t: tRoles } = useT('roles');
  const { owner } = apiKey;

  let label: string;
  switch (owner.kind) {
    case 'user':
      label = t('apiKeys.owner.you');
      break;
    case 'member':
      label =
        owner.userId === viewerUserId
          ? t('apiKeys.owner.you')
          : (owner.name ?? owner.email ?? t('apiKeys.owner.formerMember'));
      break;
    case 'team':
      label = t('apiKeys.owner.team', {
        name: owner.teamName ?? t('apiKeys.owner.deletedTeam'),
      });
      break;
    case 'project':
      label = t('apiKeys.owner.project', {
        name: owner.projectName ?? t('apiKeys.owner.deletedProject'),
      });
      break;
    case 'organization':
      label = t('apiKeys.owner.organization');
      break;
  }

  const detail =
    apiKey.role !== null
      ? t('apiKeys.owner.actsAs', { role: tRoles(apiKey.role) })
      : owner.kind === 'member' && apiKey.createdBy !== null
        ? t('apiKeys.owner.madeBy', {
            name: apiKey.createdBy.name ?? t('apiKeys.owner.formerMember'),
          })
        : null;

  return (
    <div className="flex min-w-0 flex-col">
      <Text as="span" truncate className="text-sm">
        {label}
      </Text>
      {detail !== null && (
        <Text as="span" variant="muted" truncate className="text-xs">
          {detail}
        </Text>
      )}
    </div>
  );
}
