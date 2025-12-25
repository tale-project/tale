'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import DeleteVendorDialog from './delete-vendor-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';
import { useDeleteVendor } from './hooks';

interface DeleteVendorButtonProps {
  vendor: Doc<'vendors'>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
}

export default function DeleteVendorButton({
  vendor,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  asChild = false,
}: DeleteVendorButtonProps) {
  const { t: tVendors } = useT('vendors');
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteVendor = useDeleteVendor();

  // Use controlled state if provided, otherwise use internal state
  const isDialogOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsDialogOpen = controlledOnOpenChange || setInternalIsOpen;

  const handleDeleteVendor = async () => {
    try {
      setIsDeleting(true);

      await deleteVendor({
        vendorId: vendor._id,
      });
      setIsDialogOpen(false);
    } catch (err) {
      console.error('Deletion error:', err);
      toast({
        title: tVendors('deleteError'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

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

      <DeleteVendorDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onConfirm={handleDeleteVendor}
        vendor={vendor}
        isDeleting={isDeleting}
      />
    </>
  );
}
