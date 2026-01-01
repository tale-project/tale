'use client';

import { ConfirmDialog } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';

interface PublishAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: () => void;
  workflowName?: string;
}

export function PublishAutomationDialog({
  open,
  onOpenChange,
  onPublish,
  workflowName: _workflowName,
}: PublishAutomationDialogProps) {
  const { t } = useT('automations');

  const handlePublish = () => {
    onPublish();
    onOpenChange(false);
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('publishDialog.title')}
      description={t('publishDialog.description')}
      confirmText={t('navigation.publish')}
      onConfirm={handlePublish}
    />
  );
}
