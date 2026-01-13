'use client';

import { ConfirmDialog } from '@/components/ui/dialog/confirm-dialog';
import { useT } from '@/lib/i18n/client';

interface BulkSendMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSend: () => Promise<void>;
  isLoading: boolean;
}

export function BulkSendMessagesDialog({
  open,
  onOpenChange,
  selectedCount,
  onSend,
  isLoading,
}: BulkSendMessagesDialogProps) {
  const { t } = useT('conversations');

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('bulkSend.title', { count: selectedCount })}
      description={
        <>
          {t('bulkSend.description', { count: selectedCount })}
          <br />
          <br />
          {t('bulkSend.confirm')}
        </>
      }
      confirmText={t('bulkSend.send')}
      loadingText={t('bulkSend.sending')}
      isLoading={isLoading}
      onConfirm={onSend}
    />
  );
}
