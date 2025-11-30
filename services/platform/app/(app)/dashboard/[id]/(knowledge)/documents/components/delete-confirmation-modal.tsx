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

interface DeleteConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  isLoading?: boolean;
  fileName?: string | null;
}

export default function DeleteConfirmationModal({
  open,
  onOpenChange,
  onConfirmDelete,
  isLoading = false,
  fileName,
}: DeleteConfirmationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="py-2">Delete file</DialogTitle>
          <div className="text-left space-y-4 py-2">
            <DialogDescription className="mb-2">
              Are you sure you want to permanently delete{' '}
              <span className="font-medium text-foreground">
                {fileName ?? 'this file'}
              </span>
              ?
            </DialogDescription>
            <p className="text-sm text-muted-foreground">
              You won’t be able to recover this file after deletion.
            </p>
          </div>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2">
          <Button
            onClick={() => onOpenChange(false)}
            variant="outline"
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirmDelete}
            variant="destructive"
            disabled={isLoading}
            isLoading={isLoading}
            className="flex-1"
          >
            Delete File
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
