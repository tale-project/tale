'use client';

import { FolderPlus, Plus, HardDrive } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';

import { CreateFolderDialog } from './create-folder-dialog';

const OneDriveImportDialog = lazyComponent(() =>
  import('./onedrive-import-dialog').then((mod) => ({
    default: mod.OneDriveImportDialog,
  })),
);

const DocumentUploadDialog = lazyComponent(() =>
  import('./document-upload-dialog').then((mod) => ({
    default: mod.DocumentUploadDialog,
  })),
);

export interface DocumentsActionMenuProps {
  organizationId: string;
  currentFolderId?: string;
  parentFolderTeamId?: string;
  hasMicrosoftAccount?: boolean;
}

export function DocumentsActionMenu({
  organizationId,
  currentFolderId,
  parentFolderTeamId,
  hasMicrosoftAccount,
}: DocumentsActionMenuProps) {
  const { t: tDocuments } = useT('documents');
  const [isOneDriveDialogOpen, setIsOneDriveDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);

  const handleDeviceUpload = useCallback(() => {
    setIsUploadDialogOpen(true);
  }, []);

  const handleOneDriveClick = useCallback(() => {
    setIsOneDriveDialogOpen(true);
  }, []);

  const handleCreateFolder = useCallback(() => {
    setIsCreateFolderOpen(true);
  }, []);

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
        label: tDocuments('upload.fromMicrosoft365'),
        icon: MicrosoftIcon,
        onClick: handleOneDriveClick,
      });
    }

    items.push({
      label: tDocuments('folder.newFolder'),
      icon: FolderPlus,
      onClick: handleCreateFolder,
    });

    return items;
  }, [
    tDocuments,
    handleDeviceUpload,
    handleOneDriveClick,
    handleCreateFolder,
    hasMicrosoftAccount,
  ]);

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
          folderId={currentFolderId}
        />
      )}

      {isOneDriveDialogOpen && (
        <OneDriveImportDialog
          open={isOneDriveDialogOpen}
          onOpenChange={setIsOneDriveDialogOpen}
          organizationId={organizationId}
          onSuccess={() => setIsOneDriveDialogOpen(false)}
        />
      )}

      {isCreateFolderOpen && (
        <CreateFolderDialog
          open={isCreateFolderOpen}
          onOpenChange={setIsCreateFolderOpen}
          organizationId={organizationId}
          parentFolderId={currentFolderId}
          parentFolderTeamId={parentFolderTeamId}
        />
      )}
    </>
  );
}
