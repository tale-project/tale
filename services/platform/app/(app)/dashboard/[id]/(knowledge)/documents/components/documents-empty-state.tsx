'use client';

import { ClipboardList } from 'lucide-react';
import { DataTableEmptyState } from '@/components/ui/data-table';
import ImportDocumentsMenu from './import-documents-menu';
import { useT } from '@/lib/i18n';

interface DocumentsEmptyStateProps {
  organizationId: string;
  hasMsAccount: boolean;
}

export function DocumentsEmptyState({
  organizationId,
  hasMsAccount,
}: DocumentsEmptyStateProps) {
  const { t } = useT('emptyStates');
  return (
    <DataTableEmptyState
      icon={ClipboardList}
      title={t('documents.title')}
      description={t('documents.description')}
      action={
        <ImportDocumentsMenu
          organizationId={organizationId}
          hasMicrosoftAccount={hasMsAccount}
        />
      }
    />
  );
}
