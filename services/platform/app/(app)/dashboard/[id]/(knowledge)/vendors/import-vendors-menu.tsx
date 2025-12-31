'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu';
import { Button } from '@/components/ui/button';
import { HardDrive, NotepadText, Plus } from 'lucide-react';
import ImportVendorsDialog from './vendors-import-dialog';
import { useT } from '@/lib/i18n';

interface ImportVendorsMenuProps {
  organizationId: string;
}

export type ImportMode = 'manual' | 'upload';

export default function ImportVendorsMenu({
  organizationId,
}: ImportVendorsMenuProps) {
  const { t } = useT('vendors');
  const router = useRouter();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('manual');

  const handleManualEntryClick = () => {
    setImportMode('manual');
    setIsDialogOpen(true);
  };

  const handleUploadClick = () => {
    setImportMode('upload');
    setIsDialogOpen(true);
  };

  return (
    <>
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                {t('importMenu.importVendors')}
              </Button>
            </NavigationMenuTrigger>
            <NavigationMenuContent className="top-10 z-40 md:w-44 right-0">
              <ul className="p-1 space-y-1 z-10 bg-background ring-1 ring-border rounded-md">
                <li>
                  <NavigationMenuLink asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleUploadClick}
                      className="w-full justify-start"
                    >
                      <HardDrive className="size-4 mr-2" />
                      <span>{t('importMenu.fromDevice')}</span>
                    </Button>
                  </NavigationMenuLink>
                </li>
                <li>
                  <NavigationMenuLink asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleManualEntryClick}
                      className="w-full justify-start"
                    >
                      <NotepadText className="size-4 mr-2" />
                      <span>{t('importMenu.manualEntry')}</span>
                    </Button>
                  </NavigationMenuLink>
                </li>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>

      <ImportVendorsDialog
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
