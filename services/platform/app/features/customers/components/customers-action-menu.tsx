'use client';

import { useNavigate } from '@tanstack/react-router';
import { Plus, HardDrive, NotepadText } from 'lucide-react';
import { useState, useCallback } from 'react';

import { CirculyIcon } from '@/app/components/icons/circuly-icon';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
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
  const navigate = useNavigate();
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
    void navigate({
      to: '/dashboard/$id/settings/integrations',
      params: { id: organizationId },
      search: { tab: 'circuly' },
    });
  }, [navigate, organizationId]);

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
