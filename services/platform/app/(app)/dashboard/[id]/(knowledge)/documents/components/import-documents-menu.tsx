'use client';

import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuLink,
} from '@/components/ui/navigation/navigation-menu';
import { Button } from '@/components/ui/primitives/button';
import { OneDriveIcon } from '@/components/icons/onedrive-icon';
import { HardDrive, Plus } from 'lucide-react';
import { useDocumentUpload } from '../hooks/use-document-upload';
import { useT } from '@/lib/i18n/client';

// Lazy-load OneDrive dialog to reduce initial bundle size
const OneDriveImportDialog = dynamic(
  () =>
    import('./onedrive-import-dialog').then((mod) => ({
      default: mod.OneDriveImportDialog,
    })),
);

interface ImportDocumentsMenuProps {
  organizationId: string;
  hasMicrosoftAccount?: boolean;
}

export function ImportDocumentsMenu({
  organizationId,
  hasMicrosoftAccount,
}: ImportDocumentsMenuProps) {
  const { t } = useT('documents');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOneDriveImportDialogOpen, setIsOneDriveImportDialogOpen] =
    useState(false);
  const { uploadFiles, isUploading } = useDocumentUpload({
    organizationId,
  });

  const handleUploadComplete = () => {
    setIsOneDriveImportDialogOpen(false);
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []) as File[];
    if (files.length === 0) return;

    await uploadFiles(files);

    // Reset the input
    if (event.target) {
      event.target.value = '';
    }
  };

  const connectOneDrive = () => {
    setIsOneDriveImportDialogOpen(true);
  };

  return (
    <>
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                {t('upload.importDocuments')}
              </Button>
            </NavigationMenuTrigger>
            <NavigationMenuContent className="top-10 z-40 md:w-44 right-0">
              <ul className="p-1 space-y-1 z-10 bg-background ring-1 ring-border rounded-md">
                <li>
                  <NavigationMenuLink asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleFileSelect}
                      disabled={isUploading}
                      className="w-full justify-start"
                    >
                      <HardDrive className="size-4 mr-2" />
                      <span>{t('upload.fromYourDevice')}</span>
                    </Button>
                  </NavigationMenuLink>
                </li>
                {hasMicrosoftAccount && (
                  <li>
                    <NavigationMenuLink asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={connectOneDrive}
                        className="w-full justify-start"
                      >
                        <OneDriveIcon className="size-4 mr-2" />
                        <span>{t('upload.fromOneDrive')}</span>
                      </Button>
                    </NavigationMenuLink>
                  </li>
                )}
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>

      {isUploading && (
        <div className="fixed bottom-4 right-4 p-3 border rounded-lg bg-background shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">{t('upload.uploading')}</span>
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

      {isOneDriveImportDialogOpen && (
        <OneDriveImportDialog
          open={isOneDriveImportDialogOpen}
          onOpenChange={setIsOneDriveImportDialogOpen}
          organizationId={organizationId}
          onSuccess={handleUploadComplete}
        />
      )}
    </>
  );
}
