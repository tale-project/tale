'use client';

import { Plus } from 'lucide-react';
import { useState, useCallback } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { AddWebsiteDialog } from './website-add-dialog';

interface WebsitesActionMenuProps {
  organizationId: string;
  /** Optionally lift create-dialog state so the list's empty-state CTA can open it. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export function WebsitesActionMenu({
  organizationId,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
}: WebsitesActionMenuProps) {
  const { t: tWebsites } = useT('websites');
  const ability = useAbility();
  const [internalAddOpen, setInternalAddOpen] = useState(false);
  const isAddDialogOpen = controlledCreateOpen ?? internalAddOpen;
  const setIsAddDialogOpen = onCreateOpenChange ?? setInternalAddOpen;

  const handleAddClick = useCallback(() => {
    setIsAddDialogOpen(true);
  }, [setIsAddDialogOpen]);

  if (ability.cannot('write', 'knowledgeWrite')) {
    return null;
  }

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
