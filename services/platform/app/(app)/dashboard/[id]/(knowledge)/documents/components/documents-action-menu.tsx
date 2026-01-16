'use client';

import { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Plus, HardDrive } from 'lucide-react';
import { DataTableActionMenu, type DataTableActionMenuItem } from '@/components/ui/data-table/data-table-action-menu';
import { OneDriveIcon } from '@/components/icons/onedrive-icon';
import { useT } from '@/lib/i18n/client';

// Lazy-load dialogs to reduce initial bundle size
const OneDriveImportDialog = dynamic(
  () => import('./onedrive-import-dialog').then(mod => ({ default: mod.OneDriveImportDialog })),
);

const DocumentUploadDialog = dynamic(
  () => import('./document-upload-dialog').then(mod => ({ default: mod.DocumentUploadDialog })),
);

export interface DocumentsActionMenuProps {
  organizationId: string;
  hasMicrosoftAccount?: boolean;
}

export function DocumentsActionMenu({
  organizationId,
  hasMicrosoftAccount,
}: DocumentsActionMenuProps) {
  const { t: tDocuments } = useT('documents');
  const [isOneDriveDialogOpen, setIsOneDriveDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const handleDeviceUpload = useCallback(() => {
    setIsUploadDialogOpen(true);
  }, []);

  const handleOneDriveClick = useCallback(() => {
    setIsOneDriveDialogOpen(true);
  }, []);

  const handleOneDriveSuccess = useCallback(() => {
    setIsOneDriveDialogOpen(false);
  }, []);

  // Build menu items conditionally
  const menuItems = useMemo<DataTableActionMenuItem[]>(() => {
    const items: DataTableActionMenuItem[] = [
      {
        label: tDocuments('upload.fromYourDevice'),
        icon: HardDrive,
        onClick: handleDeviceUpload,
      },
    ];

    if (hasMicrosoftAccount) {
      items.push({
        label: tDocuments('upload.fromOneDrive'),
        icon: OneDriveIcon,
        onClick: handleOneDriveClick,
      });
    }

    return items;
  }, [tDocuments, handleDeviceUpload, handleOneDriveClick, hasMicrosoftAccount]);

  return (
    <>
      <DataTableActionMenu
        label={tDocuments('upload.importDocuments')}
        icon={Plus}
        menuItems={menuItems}
      />

      {isUploadDialogOpen && (
        <DocumentUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          organizationId={organizationId}
        />
      )}

      {isOneDriveDialogOpen && (
        <OneDriveImportDialog
          open={isOneDriveDialogOpen}
          onOpenChange={setIsOneDriveDialogOpen}
          organizationId={organizationId}
          onSuccess={handleOneDriveSuccess}
        />
      )}
    </>
  );
}
