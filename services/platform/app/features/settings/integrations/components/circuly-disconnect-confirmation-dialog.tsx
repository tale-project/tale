'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface CirculyDisconnectConfirmationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  username?: string;
  onConfirm: () => Promise<void> | void;
}

export function CirculyDisconnectConfirmationDialog({
  open,
  onOpenChange,
  username,
  onConfirm,
}: CirculyDisconnectConfirmationDialogProps) {
  const { t } = useT('settings');
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsDisconnecting(true);
      await onConfirm();

      toast({
        title: t('integrations.disconnectedSuccessfully', {
          provider: 'Circuly',
        }),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: t('integrations.disconnectionFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.failedToDisconnect', { provider: 'Circuly' }),
        variant: 'destructive',
      });

      setIsDisconnecting(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.disconnectConfirm', { provider: 'Circuly' })}
      confirmText={t('integrations.circuly.yesDisconnect')}
      loadingText={t('integrations.disconnecting')}
      isLoading={isDisconnecting}
      onConfirm={handleConfirm}
      variant="destructive"
    >
      <Stack gap={3}>
        {username && (
          <Stack gap={1}>
            <p className="text-foreground text-sm font-medium">
              {t('integrations.circuly.connectedAccount')}
            </p>
            <p className="text-muted-foreground text-sm">{username}</p>
          </Stack>
        )}

        <Stack gap={2}>
          <p className="text-foreground text-sm">
            {t('integrations.circuly.disconnectQuestion')}
          </p>

          <div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
            <p className="text-destructive text-sm">
              {t('integrations.circuly.disconnectWarning')}
            </p>
          </div>
        </Stack>
      </Stack>
    </ConfirmDialog>
  );
}
