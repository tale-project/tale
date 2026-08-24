'use client';

import { FolderPlus, HardDrive, Upload } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
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
  /** Controlled open state for the Microsoft 365 picker (OAuth return). */
  oneDriveOpen?: boolean;
  onOneDriveOpenChange?: (open: boolean) => void;
}

export function DocumentsActionMenu({
  organizationId,
  currentFolderId,
  parentFolderTeamId,
  oneDriveOpen,
  onOneDriveOpenChange,
}: DocumentsActionMenuProps) {
  const { t: tDocuments } = useT('documents');
  const ability = useAbility();

  const [uncontrolledOneDriveOpen, setUncontrolledOneDriveOpen] =
    useState(false);
  const isOneDriveDialogOpen = oneDriveOpen ?? uncontrolledOneDriveOpen;
  const setIsOneDriveDialogOpen =
    onOneDriveOpenChange ?? setUncontrolledOneDriveOpen;

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);

  const handleDeviceUpload = useCallback(() => {
    setIsUploadDialogOpen(true);
  }, []);

  const handleOneDriveClick = useCallback(() => {
    setIsOneDriveDialogOpen(true);
  }, [setIsOneDriveDialogOpen]);

  const handleCreateFolder = useCallback(() => {
    setIsCreateFolderOpen(true);
  }, []);

  const menuItems = useMemo<DataTableActionMenuItem[]>(() => {
    return [
      {
        label: tDocuments('upload.fromYourDevice'),
        icon: HardDrive,
        onClick: handleDeviceUpload,
      },
      {
        label: tDocuments('upload.fromMicrosoft365'),
        icon: MicrosoftIcon,
        onClick: handleOneDriveClick,
      },
      {
        label: tDocuments('folder.newFolder'),
        icon: FolderPlus,
        onClick: handleCreateFolder,
      },
    ];
  }, [tDocuments, handleDeviceUpload, handleOneDriveClick, handleCreateFolder]);

  if (ability.cannot('write', 'knowledgeWrite')) {
    return null;
  }

  return (
    <>
      <DataTableActionMenu
        label={tDocuments('upload.importDocuments')}
        icon={Upload}
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
