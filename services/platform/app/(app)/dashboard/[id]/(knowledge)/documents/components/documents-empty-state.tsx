'use client';

import { ClipboardList } from 'lucide-react';
import { DataTableEmptyState } from '@/components/ui/data-table';
import { DocumentsActionMenu } from './documents-action-menu';
import { useT } from '@/lib/i18n';

interface DocumentsEmptyStateProps {
  organizationId: string;
  hasMicrosoftAccount?: boolean;
}

export function DocumentsEmptyState({
  organizationId,
  hasMicrosoftAccount,
}: DocumentsEmptyStateProps) {
  const { t } = useT('emptyStates');

  return (
    <DataTableEmptyState
      icon={ClipboardList}
      title={t('documents.title')}
      description={t('documents.description')}
      actionMenu={
        <DocumentsActionMenu
          organizationId={organizationId}
          hasMicrosoftAccount={hasMicrosoftAccount}
        />
      }
    />
  );
}
