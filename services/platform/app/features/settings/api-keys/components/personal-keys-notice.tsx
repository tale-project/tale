'use client';

import { Alert } from '@tale/ui/alert';

import { useMyApiKeyAccess } from '@/app/features/settings/governance/hooks/queries';
import { useT } from '@/lib/i18n/client';

interface PersonalKeysNoticeProps {
  organizationId: string;
}

const COPY = {
  refused: {
    title: 'apiKeys.personalKeys.refusedTitle',
    body: 'apiKeys.personalKeys.refusedBody',
  },
  unavailable: {
    title: 'apiKeys.personalKeys.unavailableTitle',
    body: 'apiKeys.personalKeys.unavailableBody',
  },
} as const;

/**
 * Tells the reader when the API keys they make for themselves do not work in
 * this organization: an Owner or Admin turned members' personal keys off here
 * (`refused`), or the setting cannot be read, which refuses them until it can
 * (`unavailable`). Says nothing while the read is on its way, when the keys
 * work here, or when the answer does not say.
 */
export function PersonalKeysNotice({
  organizationId,
}: PersonalKeysNoticeProps) {
  const { t } = useT('settings');
  const { data } = useMyApiKeyAccess(organizationId);
  const standing = data?.personalKeys;

  if (standing !== 'refused' && standing !== 'unavailable') return null;
  const copy = COPY[standing];
  return (
    // Static while it holds: it states a condition of the page, it does not
    // announce an event.
    <Alert
      variant="warning"
      live="off"
      title={t(copy.title)}
      description={t(copy.body)}
    />
  );
}
