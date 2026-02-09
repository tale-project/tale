'use client';

import { Plus } from 'lucide-react';
import { useState, useCallback } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { AddWebsiteDialog } from './website-add-dialog';

interface WebsitesActionMenuProps {
  organizationId: string;
}

export function WebsitesActionMenu({
  organizationId,
}: WebsitesActionMenuProps) {
  const { t: tWebsites } = useT('websites');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const handleAddClick = useCallback(() => {
    setIsAddDialogOpen(true);
  }, []);

  return (
    <>
      <DataTableActionMenu
        label={tWebsites('addButton')}
        icon={Plus}
        onClick={handleAddClick}
      />
      <AddWebsiteDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        organizationId={organizationId}
      />
    </>
  );
}
