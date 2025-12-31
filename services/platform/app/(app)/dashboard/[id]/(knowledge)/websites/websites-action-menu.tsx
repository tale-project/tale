'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { DataTableActionMenu } from '@/components/ui/data-table';
import AddWebsiteDialog from './website-add-dialog';
import { useT } from '@/lib/i18n';

interface WebsitesActionMenuProps {
  organizationId: string;
}

export function WebsitesActionMenu({ organizationId }: WebsitesActionMenuProps) {
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
