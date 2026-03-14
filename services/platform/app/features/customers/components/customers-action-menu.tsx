'use client';

import { Plus, HardDrive, NotepadText } from 'lucide-react';
import { useState, useCallback } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { ImportCustomersDialog } from './customers-import-dialog';

export type ImportMode = 'manual' | 'upload';

interface CustomersActionMenuProps {
  organizationId: string;
}

export function CustomersActionMenu({
  organizationId,
}: CustomersActionMenuProps) {
  const { t: tCustomers } = useT('customers');
  const ability = useAbility();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('manual');

  const handleUploadClick = useCallback(() => {
    setImportMode('upload');
    setIsDialogOpen(true);
  }, []);

  const handleManualEntryClick = useCallback(() => {
    setImportMode('manual');
    setIsDialogOpen(true);
  }, []);

  if (ability.cannot('write', 'knowledgeWrite')) {
    return null;
  }

  return (
    <>
      <DataTableActionMenu
        label={tCustomers('importMenu.importCustomers')}
        icon={Plus}
        menuItems={[
          {
            label: tCustomers('importMenu.fromDevice'),
            icon: HardDrive,
            onClick: handleUploadClick,
          },
          {
            label: tCustomers('importMenu.manualEntry'),
            icon: NotepadText,
            onClick: handleManualEntryClick,
          },
        ]}
      />
      <ImportCustomersDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        organizationId={organizationId}
        mode={importMode}
        onSuccess={() => setIsDialogOpen(false)}
      />
    </>
  );
}
