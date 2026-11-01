'use client';

import { SegmentedControl } from '@tale/ui/segmented-control';

import { useT } from '@/lib/i18n/client';

import type { ApiKeyListScope } from '../types';

interface ApiKeyScopeFilterProps {
  scope: ApiKeyListScope;
  onScopeChange: (scope: ApiKeyListScope) => void;
}

/**
 * What an Owner or Admin chooses the list by: the keys they manage, or every
 * key that works in this organization, the members' own keys included.
 */
export function ApiKeyScopeFilter({
  scope,
  onScopeChange,
}: ApiKeyScopeFilterProps) {
  const { t } = useT('settings');

  return (
    <SegmentedControl
      aria-label={t('apiKeys.scope.label')}
      value={scope}
      onValueChange={(value) => {
        if (value === 'managed' || value === 'all') {
          onScopeChange(value);
        }
      }}
      options={[
        { value: 'managed', label: t('apiKeys.scope.managed') },
        { value: 'all', label: t('apiKeys.scope.all') },
      ]}
    />
  );
}
