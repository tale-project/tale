'use client';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useState } from 'react';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface ProtelDisconnectConfirmDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  server: string;
  database: string;
  onConfirm: () => Promise<void> | void;
}

export function ProtelDisconnectConfirmationDialog({
  open,
  onOpenChange,
  server,
  database,
  onConfirm,
}: ProtelDisconnectConfirmDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConfirm = async () => {
    setIsDisconnecting(true);
    try {
      await onConfirm();
      onOpenChange?.(false);
      toast({
        title: t('integrations.protel.disconnected'),
        description: t('integrations.protel.disconnectedDescription'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to disconnect Protel:', error);
      toast({
        title: t('integrations.protel.disconnectFailed'),
        description: t('integrations.protel.disconnectFailedDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.protel.disconnectTitle')}
      description={
        <>
          {t('integrations.protel.disconnectConfirmation')}{' '}
          <strong>{server}</strong> ({t('integrations.protel.database')}: <strong>{database}</strong>).
          {' '}{t('integrations.protel.disconnectWarning')}
        </>
      }
      confirmText={t('integrations.protel.disconnect')}
      loadingText={t('integrations.protel.disconnecting')}
      isLoading={isDisconnecting}
      onConfirm={handleConfirm}
      variant="destructive"
    />
  );
}
