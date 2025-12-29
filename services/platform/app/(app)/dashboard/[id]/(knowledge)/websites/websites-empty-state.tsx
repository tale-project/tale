'use client';

import { useState, useCallback } from 'react';
import { Globe, Plus } from 'lucide-react';
import { DataTableEmptyState, DataTableActionMenu } from '@/components/ui/data-table';
import AddWebsiteDialog from './add-website-dialog';
import { useT } from '@/lib/i18n';

interface WebsitesEmptyStateProps {
  organizationId: string;
}

export function WebsitesEmptyState({ organizationId }: WebsitesEmptyStateProps) {
  const { t } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const handleAddClick = useCallback(() => {
    setIsAddDialogOpen(true);
  }, []);

  return (
    <>
      <DataTableEmptyState
        icon={Globe}
        title={t('websites.title')}
        description={t('websites.description')}
        actionMenu={
          <DataTableActionMenu
            label={tWebsites('addButton')}
            icon={Plus}
            onClick={handleAddClick}
          />
        }
      />
      <AddWebsiteDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        organizationId={organizationId}
      />
    </>
  );
}
