'use client';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { mapDsrError } from './data-subject-requests-errors';
import { useRetryErasureRequest } from './hooks/mutations';

interface RetryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: Id<'gdprErasureRequests'>;
}

export function RetryDialog({
  open,
  onOpenChange,
  requestId,
}: RetryDialogProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { mutateAsync, isPending } = useRetryErasureRequest();

  const handleConfirm = async () => {
    try {
      await mutateAsync({ requestId });
      toast({
        title: t('dataSubjectRequests.toasts.retryTitle'),
        description: t('dataSubjectRequests.toasts.retryDescription'),
        variant: 'success',
      });
      onOpenChange(false);
    } catch (err) {
      const mapped = mapDsrError(err, t);
      toast({
        title: mapped.title,
        description: mapped.description,
        variant: 'destructive',
      });
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dataSubjectRequests.dialogs.retry.title')}
      description={t('dataSubjectRequests.dialogs.retry.description')}
      confirmText={t('dataSubjectRequests.dialogs.retry.confirm')}
      cancelText={tCommon('actions.cancel')}
      isLoading={isPending}
      onConfirm={() => void handleConfirm()}
    />
  );
}
