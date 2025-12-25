'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';

interface DeleteAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  workflowName: string;
  isDeleting?: boolean;
}

export default function DeleteAutomationDialog({
  open,
  onOpenChange,
  onConfirm,
  workflowName,
  isDeleting = false,
}: DeleteAutomationDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[25rem]">
        <DialogHeader>
          <DialogTitle>{t('deleteAutomation.title')}</DialogTitle>
          <DialogDescription>
            {t('deleteAutomation.description', { name: workflowName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? tCommon('actions.deleting') : tCommon('actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
