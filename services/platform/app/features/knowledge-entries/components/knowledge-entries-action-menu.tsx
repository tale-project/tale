'use client';

import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { AddKnowledgeEntryDialog } from './knowledge-entry-add-dialog';

interface KnowledgeEntriesActionMenuProps {
  organizationId: string;
  /** Optionally lift create-dialog state so the list's empty-state CTA can open it. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export function KnowledgeEntriesActionMenu({
  organizationId,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
}: KnowledgeEntriesActionMenuProps) {
  const { t } = useT('knowledgeEntries');
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
        label={t('addButton')}
        icon={Plus}
        onClick={handleAddClick}
      />
      <AddKnowledgeEntryDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        organizationId={organizationId}
      />
    </>
  );
}
