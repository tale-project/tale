'use client';

import { ClipboardList, HardDrive, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { ContactCreateDialog } from './contact-create-dialog';
import { ImportContactsDialog } from './contacts-import-dialog';

export type ImportMode = 'manual' | 'upload';

interface ContactsActionMenuProps {
  organizationId: string;
  /** Optionally lift the create-dialog state so the empty-state CTA can open it. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export function ContactsActionMenu({
  organizationId,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
}: ContactsActionMenuProps) {
  const { t: tContacts } = useT('contacts');
  const ability = useAbility();
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const isCreateDialogOpen = controlledCreateOpen ?? internalCreateOpen;
  const setIsCreateDialogOpen = onCreateOpenChange ?? setInternalCreateOpen;
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('upload');

  const handleAddClick = useCallback(() => {
    setIsCreateDialogOpen(true);
  }, [setIsCreateDialogOpen]);

  const handleUploadClick = useCallback(() => {
    setImportMode('upload');
    setIsImportDialogOpen(true);
  }, []);

  const handlePasteClick = useCallback(() => {
    setImportMode('manual');
    setIsImportDialogOpen(true);
  }, []);

  if (ability.cannot('write', 'knowledgeWrite')) {
    return null;
  }

  return (
    <>
      {/* One flex child for the DataTable toolbar (`justify-between`): a bare
          fragment would promote Add + Import into sibling flex items and park
          them at opposite ends of the row. */}
      <div className="flex shrink-0 items-center gap-2">
        <DataTableActionMenu
          label={tContacts('addButton')}
          icon={Plus}
          onClick={handleAddClick}
        />
        <DataTableActionMenu
          label={tContacts('importMenu.importContacts')}
          variant="secondary"
          menuItems={[
            {
              label: tContacts('importMenu.fromDevice'),
              icon: HardDrive,
              onClick: handleUploadClick,
            },
            {
              label: tContacts('importMenu.pasteContacts'),
              icon: ClipboardList,
              onClick: handlePasteClick,
            },
          ]}
        />
      </div>
      <ContactCreateDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        organizationId={organizationId}
      />
      <ImportContactsDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        organizationId={organizationId}
        mode={importMode}
        onSuccess={() => setIsImportDialogOpen(false)}
      />
    </>
  );
}
