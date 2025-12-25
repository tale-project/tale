'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DialogProps } from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

interface CirculyDisconnectConfirmationDialogProps extends DialogProps {
  username?: string;
  onConfirm: () => Promise<void> | void;
}

export default function CirculyDisconnectConfirmationDialog({
  username,
  onConfirm,
  ...props
}: CirculyDisconnectConfirmationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsDisconnecting(true);
      await onConfirm();

      toast({
        title: t('integrations.disconnectedSuccessfully', { provider: 'Circuly' }),
        variant: 'success',
      });

      // Dialog will be closed by parent component after successful disconnect
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
    <Dialog {...props}>
      <DialogContent
        className="p-0"
        onInteractOutside={(e) => isDisconnecting && e.preventDefault()}
        onEscapeKeyDown={(e) => isDisconnecting && e.preventDefault()}
      >
        {/* Header */}
        <div className="border-b border-border flex items-start justify-between px-4 py-6">
          <DialogHeader className="space-y-1">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="size-4 text-destructive" />
              <DialogTitle>{t('integrations.disconnectConfirm', { provider: 'Circuly' })}</DialogTitle>
            </div>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-4 py-2 space-y-2">
          <div className="space-y-3">
            {username && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t('integrations.circuly.connectedAccount')}
                </p>
                <p className="text-sm text-muted-foreground">{username}</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm text-foreground">
                {t('integrations.circuly.disconnectQuestion')}
              </p>

              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                <p className="text-sm text-destructive">
                  {t('integrations.circuly.disconnectWarning')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border flex items-center justify-stretch p-4 gap-4">
          <DialogClose asChild>
            <Button
              variant="outline"
              className="flex-1"
              disabled={isDisconnecting}
            >
              {tCommon('actions.cancel')}
            </Button>
          </DialogClose>

          <Button
            onClick={handleConfirm}
            variant="destructive"
            className="flex-1"
            disabled={isDisconnecting}
          >
            {isDisconnecting ? t('integrations.disconnecting') : t('integrations.circuly.yesDisconnect')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
