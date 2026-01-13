'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, HardDrive, NotepadText } from 'lucide-react';
import { DataTableActionMenu } from '@/components/ui/data-table/data-table-action-menu';
import { CirculyIcon } from '@/components/icons/circuly-icon';
import { ImportCustomersDialog } from './customers-import-dialog';
import { useT } from '@/lib/i18n/client';

export type ImportMode = 'manual' | 'upload';

interface CustomersActionMenuProps {
  organizationId: string;
}

export function CustomersActionMenu({ organizationId }: CustomersActionMenuProps) {
  const { t: tCustomers } = useT('customers');
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

  const handleCirculyClick = useCallback(() => {
    router.push(
      `/dashboard/${organizationId}/settings/integrations?tab=circuly`,
    );
  }, [router, organizationId]);

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
            label: tCustomers('importMenu.fromCirculy'),
            icon: CirculyIcon,
            onClick: handleCirculyClick,
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
