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
import { Doc } from '@/convex/_generated/dataModel';

interface DeleteCustomerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  customer: Doc<'customers'>;
  isDeleting?: boolean;
}

export default function DeleteCustomerDialog({
  isOpen,
  onClose,
  onConfirm,
  customer,
  isDeleting = false,
}: DeleteCustomerDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader className="relative space-y-2 py-2">
          <DialogTitle className="font-semibold text-foreground leading-none">
            Delete customer
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground leading-5">
          Are you sure you want to delete{' '}
          <span className="font-medium text-foreground">
            {customer.name || 'this customer'}
          </span>
          ? This action can&apos;t be undone.
          <br />
          <br />
          Are you sure you want to continue?
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
