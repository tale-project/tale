'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Store, Plus, HardDrive, NotepadText } from 'lucide-react';
import { DataTableEmptyState, DataTableActionMenu } from '@/components/ui/data-table';
import ImportVendorsDialog from './import-vendors-dialog';
import { useT } from '@/lib/i18n';

interface VendorsEmptyStateProps {
  organizationId: string;
}

export type ImportMode = 'manual' | 'upload';

export function VendorsEmptyState({ organizationId }: VendorsEmptyStateProps) {
  const { t } = useT('emptyStates');
  const { t: tVendors } = useT('vendors');
  const router = useRouter();
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
      <DataTableEmptyState
        icon={Store}
        title={t('vendors.title')}
        description={t('vendors.description')}
        actionMenu={
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
        }
      />
      <ImportVendorsDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        organizationId={organizationId}
        mode={importMode}
        onSuccess={() => {
          setIsDialogOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
