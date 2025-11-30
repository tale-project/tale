'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface DeleteProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  productName: string;
  isDeleting?: boolean;
}

export default function DeleteProductDialog({
  isOpen,
  onClose,
  onConfirm,
  productName,
  isDeleting = false,
}: DeleteProductDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader className="relative space-y-2 py-2">
          <DialogTitle className="font-semibold text-foreground leading-none">
            Delete product
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground leading-5">
          Are you sure you want to delete{' '}
          <span className="font-medium">{productName || 'this product'}</span>?
          All related relationships and data will be permanently removed.
        </p>
        <DialogFooter className="flex justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2.5"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
