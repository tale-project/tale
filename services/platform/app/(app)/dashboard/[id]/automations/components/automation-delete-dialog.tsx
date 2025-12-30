'use client';

import { DeleteModal } from '@/components/ui/modals';
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

  return (
    <DeleteModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteAutomation.title')}
      description={t('deleteAutomation.description', { name: workflowName })}
      isDeleting={isDeleting}
      onDelete={onConfirm}
    />
  );
}
