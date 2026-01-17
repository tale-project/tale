'use client';

import { useState } from 'react';
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
import { useT } from '@/lib/i18n/client';

// Lazy-load dialogs to reduce initial bundle size
const OneDriveImportDialog = dynamic(
  () =>
    import('./onedrive-import-dialog').then((mod) => ({
      default: mod.OneDriveImportDialog,
    })),
);

const DocumentUploadDialog = dynamic(
  () =>
    import('./document-upload-dialog').then((mod) => ({
      default: mod.DocumentUploadDialog,
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
  const [isOneDriveImportDialogOpen, setIsOneDriveImportDialogOpen] =
    useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const handleUploadComplete = () => {
    setIsOneDriveImportDialogOpen(false);
  };

  const handleDeviceUpload = () => {
    setIsUploadDialogOpen(true);
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
                      onClick={handleDeviceUpload}
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

      {isUploadDialogOpen && (
        <DocumentUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          organizationId={organizationId}
          onSuccess={() => setIsUploadDialogOpen(false)}
        />
      )}

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
