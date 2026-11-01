'use client';

import { Alert } from '@tale/ui/alert';

import { useT } from '@/lib/i18n/client';

import type { PersonalKeysStanding } from '../types';

interface PersonalKeysListNoticeProps {
  /** Whether members' own keys work here, as the list of every key said. */
  standing: PersonalKeysStanding | undefined;
}

const COPY = {
  refused: 'apiKeys.scope.personalKeysRefused',
  unavailable: 'apiKeys.scope.personalKeysUnavailable',
} as const;

/**
 * Says why the list of every key that works here holds no member's own key:
 * an Owner or Admin turned them off in this organization (`refused`), or the
 * setting cannot be read, which refuses them until it can (`unavailable`).
 * Says nothing while they work here or before the list has answered.
 */
export function PersonalKeysListNotice({
  standing,
}: PersonalKeysListNoticeProps) {
  const { t } = useT('settings');

  if (standing !== 'refused' && standing !== 'unavailable') return null;
  return (
    // Static while it holds, and without a title: a heading here would sit
    // below the section's own.
    <Alert
      variant={standing === 'refused' ? 'info' : 'warning'}
      live="off"
      description={t(COPY[standing])}
    />
  );
}
