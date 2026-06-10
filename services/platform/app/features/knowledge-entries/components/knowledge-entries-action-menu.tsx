'use client';

import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { AddKnowledgeEntryDialog } from './knowledge-entry-add-dialog';

interface KnowledgeEntriesActionMenuProps {
  organizationId: string;
}

export function KnowledgeEntriesActionMenu({
  organizationId,
}: KnowledgeEntriesActionMenuProps) {
  const { t } = useT('knowledgeEntries');
  const ability = useAbility();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const handleAddClick = useCallback(() => {
    setIsAddDialogOpen(true);
  }, []);

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
