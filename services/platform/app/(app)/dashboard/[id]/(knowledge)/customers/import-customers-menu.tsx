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
import { CirculyIcon } from '@/components/ui/icons';
import { HardDrive, NotepadText, Plus } from 'lucide-react';
import ImportCustomersDialog from './import-customers-dialog';

interface ImportCustomersMenuProps {
  organizationId: string;
}

export type ImportMode = 'manual' | 'upload';

export default function ImportCustomersMenu({
  organizationId,
}: ImportCustomersMenuProps) {
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

  const handleCirculyClick = () => {
    router.push(
      `/dashboard/${organizationId}/settings/integrations?tab=circuly`,
    );
  };

  return (
    <>
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                Import customers
              </Button>
            </NavigationMenuTrigger>
            <NavigationMenuContent className="top-10 z-40 md:w-48 right-0">
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
                      <span>From your device</span>
                    </Button>
                  </NavigationMenuLink>
                </li>
                <li>
                  <NavigationMenuLink asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCirculyClick}
                      className="w-full justify-start"
                    >
                      <CirculyIcon className="size-4 mr-2" />
                      <span>From Circuly</span>
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
                      <span>Manual entry</span>
                    </Button>
                  </NavigationMenuLink>
                </li>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>

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
