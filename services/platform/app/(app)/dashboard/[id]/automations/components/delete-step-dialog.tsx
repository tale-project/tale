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
import { Trash2, AlertTriangle } from 'lucide-react';
import { Doc } from '@/convex/_generated/dataModel';

interface DeleteStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: Doc<'wfStepDefs'> | null;
  onConfirm: () => void;
  isLoading?: boolean;
}

export default function DeleteStepDialog({
  open,
  onOpenChange,
  step,
  onConfirm,
  isLoading = false,
}: DeleteStepDialogProps) {
  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false);
    }
  };

  const handleConfirm = () => {
    onConfirm();
  };

  if (!step) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
              <AlertTriangle className="size-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <DialogTitle>Delete step</DialogTitle>
              <DialogDescription>
                This action cannot be undone
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            Are you sure you want to delete the step{' '}
            <span className="font-semibold text-foreground">
              &quot;{step.name}&quot;
            </span>
            ?
          </p>

          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium mb-1">Warning</p>
                <p>
                  This may break your automation if other steps depend on this
                  one. Make sure to update any references in other steps&apos;
                  &quot;Next Steps&quot; configuration.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Step Slug:</span>{' '}
              <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                {step.stepSlug}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Type:</span>{' '}
              <span className="capitalize">{step.stepType}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Order:</span> #
              {step.order}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="size-4 mr-1" />
                Delete step
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
