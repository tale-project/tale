'use client';

import { Plus, HardDrive, NotepadText } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { ImportCustomersDialog } from './customers-import-dialog';

export type ImportMode = 'manual' | 'upload';

interface CustomersActionMenuProps {
  organizationId: string;
  /** Optionally lift dialog state so the empty-state CTA can open manual entry. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export function CustomersActionMenu({
  organizationId,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
}: CustomersActionMenuProps) {
  const { t: tCustomers } = useT('customers');
  const ability = useAbility();
  const [internalOpen, setInternalOpen] = useState(false);
  const isDialogOpen = controlledCreateOpen ?? internalOpen;
  const setIsDialogOpen = onCreateOpenChange ?? setInternalOpen;
  const [importMode, setImportMode] = useState<ImportMode>('manual');

  // The external CTA always opens manual entry, never the upload tab.
  useEffect(() => {
    if (controlledCreateOpen) setImportMode('manual');
  }, [controlledCreateOpen]);

  const handleUploadClick = useCallback(() => {
    setImportMode('upload');
    setIsDialogOpen(true);
  }, [setIsDialogOpen]);

  const handleManualEntryClick = useCallback(() => {
    setImportMode('manual');
    setIsDialogOpen(true);
  }, [setIsDialogOpen]);

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
