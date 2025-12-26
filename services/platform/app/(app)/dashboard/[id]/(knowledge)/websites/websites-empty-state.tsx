'use client';

import { Globe } from 'lucide-react';
import { DataTableEmptyState } from '@/components/ui/data-table';
import AddWebsiteButton from './add-website-button';
import { useT } from '@/lib/i18n';

interface WebsitesEmptyStateProps {
  organizationId: string;
}

export function WebsitesEmptyState({ organizationId }: WebsitesEmptyStateProps) {
  const { t } = useT('emptyStates');
  return (
    <DataTableEmptyState
      icon={Globe}
      title={t('websites.title')}
      description={t('websites.description')}
      action={<AddWebsiteButton organizationId={organizationId} />}
    />
  );
}
