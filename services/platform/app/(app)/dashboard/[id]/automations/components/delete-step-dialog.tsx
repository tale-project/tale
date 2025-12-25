'use client';

import { DeleteModal } from '@/components/ui/modals';
import { AlertTriangle } from 'lucide-react';
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
      description={t('deleteStep.description')}
      deleteText={t('deleteStep.deleteButton')}
      deletingText={t('deleteStep.deleting')}
      isDeleting={isLoading}
      onDelete={onConfirm}
    >
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
            <p>{t('deleteStep.warningMessage')}</p>
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
    </DeleteModal>
  );
}
