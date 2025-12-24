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
import { useT } from '@/lib/i18n';

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
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="py-2">{tDocuments('deleteSyncFolder.title')}</DialogTitle>
          <div className="text-left space-y-4 py-2">
            <DialogDescription className="mb-2">
              {tDocuments('deleteSyncFolder.confirmation')}
              <span className="font-medium text-foreground">
                {` ${folderName}`}
              </span>
              ?
            </DialogDescription>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{tDocuments('deleteSyncFolder.thisWillDelete')}</p>
              <ul className="text-sm text-muted-foreground ml-4 space-y-1 list-disc">
                <li>{tDocuments('deleteSyncFolder.willDelete.filesAndSubfolders')}</li>
                <li>{tDocuments('deleteSyncFolder.willDelete.autoSyncConfig')}</li>
                <li>{tDocuments('deleteSyncFolder.willDelete.syncHistory')}</li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {tDocuments('deleteSyncFolder.willNotDelete.prefix')}{' '}
                <strong className="text-foreground">{tDocuments('deleteSyncFolder.willNotDelete.not')}</strong>{' '}
                {tDocuments('deleteSyncFolder.willNotDelete.suffix')}
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
            {tCommon('actions.cancel')}
          </Button>
          <Button
            onClick={onConfirmDelete}
            variant="destructive"
            disabled={isLoading}
            isLoading={isLoading}
            className="flex-1"
          >
            {tDocuments('deleteSyncFolder.deleteButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
