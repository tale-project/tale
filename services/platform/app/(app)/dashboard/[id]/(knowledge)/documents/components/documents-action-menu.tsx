'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Plus, HardDrive } from 'lucide-react';
import { DataTableActionMenu, type DataTableActionMenuItem } from '@/components/ui/data-table';
import { OneDriveIcon } from '@/components/icons';
import { useDocumentUpload } from '../hooks/use-document-upload';
import { useT } from '@/lib/i18n';

// Lazy-load OneDrive dialog to avoid MGT bundle size impact and SSR issues
const OneDriveImportDialog = dynamic(() => import('./onedrive-import-dialog').then(mod => ({ default: mod.OneDriveImportDialog })), {
  ssr: false,
});

export interface DocumentsActionMenuProps {
  organizationId: string;
  hasMicrosoftAccount?: boolean;
}

export function DocumentsActionMenu({
  organizationId,
  hasMicrosoftAccount,
}: DocumentsActionMenuProps) {
  const { t: tDocuments } = useT('documents');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOneDriveDialogOpen, setIsOneDriveDialogOpen] = useState(false);

  // Data refresh happens automatically via Convex reactivity when documents page uses preloadQuery
  const { uploadFiles, isUploading } = useDocumentUpload({
    organizationId,
  });

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []) as File[];
    if (files.length === 0) return;

    await uploadFiles(files);

    // Reset the input
    if (event.target) {
      event.target.value = '';
    }
  }, [uploadFiles]);

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
        onClick: handleFileSelect,
        disabled: isUploading,
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
  }, [tDocuments, handleFileSelect, handleOneDriveClick, hasMicrosoftAccount, isUploading]);

  return (
    <>
      <DataTableActionMenu
        label={tDocuments('upload.importDocuments')}
        icon={Plus}
        menuItems={menuItems}
      />

      {isUploading && (
        <div className="fixed bottom-4 right-4 p-3 border rounded-lg bg-background shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">{tDocuments('upload.uploading')}</span>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        disabled={isUploading}
        accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
        onChange={handleFileChange}
        className="hidden"
      />

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
