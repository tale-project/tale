'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface DeleteVendorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  vendor: Doc<'vendors'>;
  isDeleting?: boolean;
}

export default function DeleteVendorDialog({
  isOpen,
  onClose,
  onConfirm,
  vendor,
  isDeleting = false,
}: DeleteVendorDialogProps) {
  const { t: tCommon } = useT('common');
  const { t: tVendors } = useT('vendors');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader className="relative space-y-2">
          <DialogTitle className="font-semibold text-foreground leading-none py-2">
            {tVendors('deleteVendor')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground leading-5">
          {tVendors('deleteConfirmation', { name: vendor.name || tVendors('thisVendor') })}
        </p>
        <DialogFooter className="flex justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2.5"
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700"
          >
            {isDeleting ? tCommon('actions.deleting') : tCommon('actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
