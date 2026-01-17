'use client';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { useT } from '@/lib/i18n/client';

interface DeleteAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  workflowName: string;
  isDeleting?: boolean;
}

export function DeleteAutomationDialog({
  open,
  onOpenChange,
  onConfirm,
  workflowName,
  isDeleting = false,
}: DeleteAutomationDialogProps) {
  const { t } = useT('automations');

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteAutomation.title')}
      description={t('deleteAutomation.description', { name: workflowName })}
      isDeleting={isDeleting}
      onDelete={onConfirm}
    />
  );
}
