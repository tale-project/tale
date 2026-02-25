'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
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
      <FieldGroup gap={3}>
        {username && (
          <Field label={t('integrations.circuly.connectedAccount')}>
            <Text variant="muted">{username}</Text>
          </Field>
        )}

        <Stack gap={2}>
          <Text variant="body">
            {t('integrations.circuly.disconnectQuestion')}
          </Text>

          <div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
            <Text variant="error">
              {t('integrations.circuly.disconnectWarning')}
            </Text>
          </div>
        </Stack>
      </FieldGroup>
    </ConfirmDialog>
  );
}
