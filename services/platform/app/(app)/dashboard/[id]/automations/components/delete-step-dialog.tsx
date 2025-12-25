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
import { useT } from '@/lib/i18n';

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
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
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
              <DialogTitle>{t('deleteStep.title')}</DialogTitle>
              <DialogDescription>
                {t('deleteStep.description')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            {t('deleteStep.confirmMessage')}{' '}
            <span className="font-semibold text-foreground">
              &quot;{step.name}&quot;
            </span>
            ?
          </p>

          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium mb-1">{t('deleteStep.warning')}</p>
                <p>
                  {t('deleteStep.warningMessage')}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="text-sm">
              <span className="text-muted-foreground">{t('deleteStep.stepSlug')}</span>{' '}
              <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                {step.stepSlug}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">{t('deleteStep.type')}</span>{' '}
              <span className="capitalize">{step.stepType}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">{t('deleteStep.order')}</span> #
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
            {tCommon('actions.cancel')}
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
                {t('deleteStep.deleting')}
              </>
            ) : (
              <>
                <Trash2 className="size-4 mr-1" />
                {t('deleteStep.deleteButton')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
