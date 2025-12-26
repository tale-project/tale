'use client';

import { DeleteModal } from '@/components/ui/modals';
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

  if (!step) return null;

  return (
    <DeleteModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteStep.title')}
      description={t('deleteStep.confirmMessage', { name: step.name })}
      deleteText={t('deleteStep.deleteButton')}
      deletingText={t('deleteStep.deleting')}
      isDeleting={isLoading}
      onDelete={onConfirm}
      warning={`${t('deleteStep.warning')}: ${t('deleteStep.warningMessage')}`}
    >
      <div className="space-y-2">
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
    </DeleteModal>
  );
}
