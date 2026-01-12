'use client';

import { useState, useCallback, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Doc } from '@/convex/_generated/dataModel';
import { EntityDeleteDialog } from '@/components/ui/entity/entity-delete-dialog';
import { useT } from '@/lib/i18n/client';
import { useDeleteVendor } from '../hooks/use-delete-vendor';

interface DeleteVendorButtonProps {
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
}: DeleteVendorButtonProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tToast } = useT('toast');
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const deleteVendor = useDeleteVendor();

  const isDialogOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsDialogOpen = controlledOnOpenChange || setInternalIsOpen;

  const handleDelete = useCallback(
    async (v: Doc<'vendors'>) => {
      await deleteVendor({ vendorId: v._id });
    },
    [deleteVendor]
  );

  const getEntityName = useCallback(
    (v: Doc<'vendors'>) => v.name || tVendors('thisVendor'),
    [tVendors]
  );

  const translations = useMemo(
    () => ({
      title: tVendors('deleteVendor'),
      description: tVendors('deleteConfirmation', { name: '{name}' }),
      successMessage: tToast('success.deleted'),
      errorMessage: tVendors('deleteError'),
    }),
    [tVendors, tToast]
  );

  return (
    <>
      {!asChild && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsDialogOpen(true)}
          aria-label={tVendors('deleteVendor')}
          className="hover:bg-transparent"
        >
          <Trash2 className="size-4" />
        </Button>
      )}

      <EntityDeleteDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        entity={vendor}
        getEntityName={getEntityName}
        deleteMutation={handleDelete}
        translations={translations}
      />
    </>
  );
}
