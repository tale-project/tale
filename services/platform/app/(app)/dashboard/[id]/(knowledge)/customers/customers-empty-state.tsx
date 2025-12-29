'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Plus, HardDrive, NotepadText } from 'lucide-react';
import { DataTableEmptyState, DataTableActionMenu } from '@/components/ui/data-table';
import { CirculyIcon } from '@/components/ui/icons';
import ImportCustomersDialog from './import-customers-dialog';
import { useT } from '@/lib/i18n';

interface CustomersEmptyStateProps {
  organizationId: string;
}

export type ImportMode = 'manual' | 'upload';

export function CustomersEmptyState({ organizationId }: CustomersEmptyStateProps) {
  const { t } = useT('emptyStates');
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
      <DataTableEmptyState
        icon={Users}
        title={t('customers.title')}
        description={t('customers.description')}
        actionMenu={
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
        }
      />
      <ImportCustomersDialog
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
