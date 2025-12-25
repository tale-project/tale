'use client';

import { ConfirmModal } from '@/components/ui/modals';
import { useT } from '@/lib/i18n';

interface PublishAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: () => void;
  workflowName?: string;
}

export default function PublishAutomationDialog({
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
    <ConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('publishDialog.title')}
      description={t('publishDialog.description')}
      confirmText={t('navigation.publish')}
      onConfirm={handlePublish}
    />
  );
}
