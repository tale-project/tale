'use client';

import { Key } from 'lucide-react';

import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { useT } from '@/lib/i18n/client';

import { ApiKeysActionMenu } from './api-keys-action-menu';

interface ApiKeysEmptyStateProps {
  organizationId: string;
}

export function ApiKeysEmptyState({ organizationId }: ApiKeysEmptyStateProps) {
  const { t } = useT('emptyStates');

  return (
    <DataTableEmptyState
      icon={Key}
      title={t('apiKeys.title')}
      description={t('apiKeys.description')}
      actionMenu={<ApiKeysActionMenu organizationId={organizationId} />}
    />
  );
}
