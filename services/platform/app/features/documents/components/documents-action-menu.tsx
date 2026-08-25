'use client';

import { FolderPlus, HardDrive, Upload } from 'lucide-react';
import { useState, useCallback, useMemo, useEffect } from 'react';

import { GoogleIcon } from '@/app/components/icons/google-icon';
import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';

import { useCloudImportAuthorizationStatus } from '../hooks/queries';
import { CloudImportConnectDialog } from './cloud-import-connect-dialog';
import { CreateFolderDialog } from './create-folder-dialog';

const OneDriveImportDialog = lazyComponent(() =>
  import('./onedrive-import-dialog').then((mod) => ({
    default: mod.OneDriveImportDialog,
  })),
);

const GoogleDriveImportDialog = lazyComponent(() =>
  import('./google-drive-import-dialog').then((mod) => ({
    default: mod.GoogleDriveImportDialog,
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
  /** Controlled open state for the Google Drive picker (OAuth return). */
  googleDriveOpen?: boolean;
  onGoogleDriveOpenChange?: (open: boolean) => void;
}

export function DocumentsActionMenu({
  organizationId,
  currentFolderId,
  parentFolderTeamId,
  oneDriveOpen,
  onOneDriveOpenChange,
  googleDriveOpen,
  onGoogleDriveOpenChange,
}: DocumentsActionMenuProps) {
  const { t: tDocuments } = useT('documents');
  const ability = useAbility();

  const { data: microsoftAuth, isLoading: microsoftAuthLoading } =
    useCloudImportAuthorizationStatus(organizationId, true, 'onedrive');
  const { data: googleAuth, isLoading: googleAuthLoading } =
    useCloudImportAuthorizationStatus(organizationId, true, 'google-drive');

  const [uncontrolledOneDriveImportOpen, setUncontrolledOneDriveImportOpen] =
    useState(false);
  const isOneDriveImportOpen = oneDriveOpen ?? uncontrolledOneDriveImportOpen;
  const setIsOneDriveImportOpen =
    onOneDriveOpenChange ?? setUncontrolledOneDriveImportOpen;

  const [
    uncontrolledGoogleDriveImportOpen,
    setUncontrolledGoogleDriveImportOpen,
  ] = useState(false);
  const isGoogleDriveImportOpen =
    googleDriveOpen ?? uncontrolledGoogleDriveImportOpen;
  const setIsGoogleDriveImportOpen =
    onGoogleDriveOpenChange ?? setUncontrolledGoogleDriveImportOpen;

  const [isOneDriveConnectOpen, setIsOneDriveConnectOpen] = useState(false);
  const [isGoogleDriveConnectOpen, setIsGoogleDriveConnectOpen] =
    useState(false);

  // Menu click while auth status is still loading — resolve once the query
  // settles so we open connect vs picker without guessing.
  const [pendingOneDriveOpen, setPendingOneDriveOpen] = useState(false);
  const [pendingGoogleDriveOpen, setPendingGoogleDriveOpen] = useState(false);

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);

  const openOneDriveFlow = useCallback(() => {
    if (microsoftAuth?.status === 'active') {
      setIsOneDriveImportOpen(true);
    } else {
      setIsOneDriveConnectOpen(true);
    }
  }, [microsoftAuth?.status, setIsOneDriveImportOpen]);

  const openGoogleDriveFlow = useCallback(() => {
    if (googleAuth?.status === 'active') {
      setIsGoogleDriveImportOpen(true);
    } else {
      setIsGoogleDriveConnectOpen(true);
    }
  }, [googleAuth?.status, setIsGoogleDriveImportOpen]);

  useEffect(() => {
    if (!pendingOneDriveOpen || microsoftAuthLoading) return;
    setPendingOneDriveOpen(false);
    openOneDriveFlow();
  }, [pendingOneDriveOpen, microsoftAuthLoading, openOneDriveFlow]);

  useEffect(() => {
    if (!pendingGoogleDriveOpen || googleAuthLoading) return;
    setPendingGoogleDriveOpen(false);
    openGoogleDriveFlow();
  }, [pendingGoogleDriveOpen, googleAuthLoading, openGoogleDriveFlow]);

  const handleDeviceUpload = useCallback(() => {
    setIsUploadDialogOpen(true);
  }, []);

  const handleOneDriveClick = useCallback(() => {
    if (microsoftAuthLoading) {
      setPendingOneDriveOpen(true);
      return;
    }
    openOneDriveFlow();
  }, [microsoftAuthLoading, openOneDriveFlow]);

  const handleGoogleDriveClick = useCallback(() => {
    if (googleAuthLoading) {
      setPendingGoogleDriveOpen(true);
      return;
    }
    openGoogleDriveFlow();
  }, [googleAuthLoading, openGoogleDriveFlow]);

  const handleOneDriveDisconnected = useCallback(() => {
    setIsOneDriveImportOpen(false);
    setIsOneDriveConnectOpen(true);
  }, [setIsOneDriveImportOpen]);

  const handleGoogleDriveDisconnected = useCallback(() => {
    setIsGoogleDriveImportOpen(false);
    setIsGoogleDriveConnectOpen(true);
  }, [setIsGoogleDriveImportOpen]);

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
        label: tDocuments('upload.fromGoogleDrive'),
        icon: GoogleIcon,
        onClick: handleGoogleDriveClick,
      },
      {
        label: tDocuments('folder.newFolder'),
        icon: FolderPlus,
        onClick: handleCreateFolder,
      },
    ];
  }, [
    tDocuments,
    handleDeviceUpload,
    handleOneDriveClick,
    handleGoogleDriveClick,
    handleCreateFolder,
  ]);

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

      {isOneDriveConnectOpen && (
        <CloudImportConnectDialog
          open={isOneDriveConnectOpen}
          onOpenChange={setIsOneDriveConnectOpen}
          provider="onedrive"
        />
      )}

      {isGoogleDriveConnectOpen && (
        <CloudImportConnectDialog
          open={isGoogleDriveConnectOpen}
          onOpenChange={setIsGoogleDriveConnectOpen}
          provider="google-drive"
        />
      )}

      {isOneDriveImportOpen && (
        <OneDriveImportDialog
          open={isOneDriveImportOpen}
          onOpenChange={setIsOneDriveImportOpen}
          organizationId={organizationId}
          onSuccess={() => setIsOneDriveImportOpen(false)}
          onRequireConnect={handleOneDriveDisconnected}
        />
      )}

      {isGoogleDriveImportOpen && (
        <GoogleDriveImportDialog
          open={isGoogleDriveImportOpen}
          onOpenChange={setIsGoogleDriveImportOpen}
          organizationId={organizationId}
          onSuccess={() => setIsGoogleDriveImportOpen(false)}
          onRequireConnect={handleGoogleDriveDisconnected}
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
