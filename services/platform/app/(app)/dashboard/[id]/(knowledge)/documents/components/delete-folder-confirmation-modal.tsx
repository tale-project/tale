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

interface DeleteSyncFolderConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  isLoading?: boolean;
  folderName?: string | null;
}

export default function DeleteSyncFolderConfirmationModal({
  open,
  onOpenChange,
  onConfirmDelete,
  isLoading = false,
  folderName,
}: DeleteSyncFolderConfirmationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="py-2">Delete sync folder</DialogTitle>
          <div className="text-left space-y-4 py-2">
            <DialogDescription className="mb-2">
              Are you sure you want to permanently delete
              <span className="font-medium text-foreground">
                {` ${folderName}`}
              </span>
              ?
            </DialogDescription>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">This will delete:</p>
              <ul className="text-sm text-muted-foreground ml-4 space-y-1 list-disc">
                <li>All files and subfolders directly synced to this folder</li>
                <li>The auto-sync configuration for this folder</li>
                <li>All sync history and metadata</li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                This will <strong className="text-foreground">NOT</strong>{' '}
                delete any files that are not auto-synced to this folder.
              </p>
            </div>
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
            Delete Sync Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
