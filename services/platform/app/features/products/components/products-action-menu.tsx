'use client';

import { Plus, HardDrive, NotepadText } from 'lucide-react';
import { useState, useCallback } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { ProductCreateDialog } from './product-create-dialog';
import { ProductsImportDialog } from './products-import-dialog';

interface ProductsActionMenuProps {
  organizationId: string;
  /** Optionally lift the manual-create dialog state so the empty-state CTA can open it. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export function ProductsActionMenu({
  organizationId,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
}: ProductsActionMenuProps) {
  const { t: tProducts } = useT('products');
  const ability = useAbility();
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const isCreateDialogOpen = controlledCreateOpen ?? internalCreateOpen;
  const setIsCreateDialogOpen = onCreateOpenChange ?? setInternalCreateOpen;

  const handleUploadClick = useCallback(() => {
    setIsUploadDialogOpen(true);
  }, []);

  const handleManualEntryClick = useCallback(() => {
    setIsCreateDialogOpen(true);
  }, [setIsCreateDialogOpen]);

  if (ability.cannot('write', 'knowledgeWrite')) {
    return null;
  }

  return (
    <>
      <DataTableActionMenu
        label={tProducts('addButton')}
        icon={Plus}
        menuItems={[
          {
            label: tProducts('importMenu.fromDevice'),
            icon: HardDrive,
            onClick: handleUploadClick,
          },
          {
            label: tProducts('importMenu.manualEntry'),
            icon: NotepadText,
            onClick: handleManualEntryClick,
          },
        ]}
      />
      <ProductsImportDialog
        isOpen={isUploadDialogOpen}
        onClose={() => setIsUploadDialogOpen(false)}
        organizationId={organizationId}
        onSuccess={() => setIsUploadDialogOpen(false)}
      />
      <ProductCreateDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        organizationId={organizationId}
      />
    </>
  );
}
