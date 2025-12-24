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
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="py-2">{tDocuments('deleteFile.title')}</DialogTitle>
          <div className="text-left space-y-4 py-2">
            <DialogDescription className="mb-2">
              {tDocuments('deleteFile.confirmation')}{' '}
              <span className="font-medium text-foreground">
                {fileName ?? tDocuments('deleteFile.thisFile')}
              </span>
              ?
            </DialogDescription>
            <p className="text-sm text-muted-foreground">
              {tDocuments('deleteFile.warning')}
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
            {tCommon('actions.cancel')}
          </Button>
          <Button
            onClick={onConfirmDelete}
            variant="destructive"
            disabled={isLoading}
            isLoading={isLoading}
            className="flex-1"
          >
            {tDocuments('deleteFile.deleteButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
