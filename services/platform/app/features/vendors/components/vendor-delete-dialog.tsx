'use client';

import { Trash2 } from 'lucide-react';
import { useCallback } from 'react';

import { EntityDeleteDialog } from '@/app/components/ui/entity/entity-delete-dialog';
import {
  useDeleteDialog,
  useDeleteDialogTranslations,
} from '@/app/components/ui/entity/use-delete-dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useDeleteVendor } from '../hooks/mutations';

interface VendorDeleteDialogProps {
  vendor: Doc<'vendors'>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
}

export function VendorDeleteDialog({
  vendor,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  asChild = false,
}: VendorDeleteDialogProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tToast } = useT('toast');
  const { mutateAsync: deleteVendor } = useDeleteVendor();

  const dialog = useDeleteDialog({
    isOpen: controlledIsOpen,
    onOpenChange: controlledOnOpenChange,
  });

  const translations = useDeleteDialogTranslations({
    tEntity: tVendors,
    tToast,
    keys: {
      title: 'deleteVendor',
      description: 'deleteConfirmation',
      errorMessage: 'deleteError',
    },
  });

  const handleDelete = useCallback(
    async (v: Doc<'vendors'>) => {
      await deleteVendor({ vendorId: v._id });
    },
    [deleteVendor],
  );

  const getEntityName = useCallback(
    (v: Doc<'vendors'>) => v.name || tVendors('thisVendor'),
    [tVendors],
  );

  return (
    <>
      {!asChild && (
        <Button
          variant="ghost"
          size="icon"
          onClick={dialog.open}
          aria-label={tVendors('deleteVendor')}
          className="hover:bg-transparent"
        >
          <Trash2 className="size-4" />
        </Button>
      )}

      <EntityDeleteDialog
        isOpen={dialog.isOpen}
        onClose={dialog.close}
        entity={vendor}
        getEntityName={getEntityName}
        deleteMutation={handleDelete}
        translations={translations}
      />
    </>
  );
}
