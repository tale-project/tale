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
import { ShopifyIcon, CirculyIcon } from '@/components/ui/icons';
import { HardDrive, Plus } from 'lucide-react';
import ImportProductsDialog from './products-import-dialog';
import { useT } from '@/lib/i18n';

interface ImportProductsMenuProps {
  organizationId: string;
}

export default function ImportProductsMenu({
  organizationId,
}: ImportProductsMenuProps) {
  const { t } = useT('products');
  const router = useRouter();
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const handleUploadClick = () => {
    setIsUploadDialogOpen(true);
  };

  const handleShopifyClick = () => {
    router.push(
      `/dashboard/${organizationId}/settings/integrations?tab=shopify`,
    );
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
                {t('importMenu.importProducts')}
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
                      onClick={handleShopifyClick}
                      className="w-full justify-start"
                    >
                      <ShopifyIcon className="size-4 mr-2" />
                      <span>{t('importMenu.fromShopify')}</span>
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
                      <span>{t('importMenu.fromCirculy')}</span>
                    </Button>
                  </NavigationMenuLink>
                </li>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>

      <ImportProductsDialog
        isOpen={isUploadDialogOpen}
        onClose={() => setIsUploadDialogOpen(false)}
        organizationId={organizationId}
        onSuccess={() => {
          setIsUploadDialogOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
