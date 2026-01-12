'use client';

import { useState, useCallback } from 'react';
import { Plus, HardDrive, NotepadText } from 'lucide-react';
import { DataTableActionMenu } from '@/components/ui/data-table/data-table-action-menu';
import { ImportVendorsDialog } from './vendors-import-dialog';
import { useT } from '@/lib/i18n/client';

export type ImportMode = 'manual' | 'upload';

interface VendorsActionMenuProps {
  organizationId: string;
}

export function VendorsActionMenu({ organizationId }: VendorsActionMenuProps) {
  const { t: tVendors } = useT('vendors');
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

  return (
    <>
      <DataTableActionMenu
        label={tVendors('importMenu.importVendors')}
        icon={Plus}
        menuItems={[
          {
            label: tVendors('importMenu.fromDevice'),
            icon: HardDrive,
            onClick: handleUploadClick,
          },
          {
            label: tVendors('importMenu.manualEntry'),
            icon: NotepadText,
            onClick: handleManualEntryClick,
          },
        ]}
      />
      <ImportVendorsDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        organizationId={organizationId}
        mode={importMode}
        onSuccess={() => setIsDialogOpen(false)}
      />
    </>
  );
}
