'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface ShopifyDisconnectConfirmationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  domain?: string;
  onConfirm: () => Promise<void> | void;
}

export function ShopifyDisconnectConfirmationDialog({
  open,
  onOpenChange,
  domain,
  onConfirm,
}: ShopifyDisconnectConfirmationDialogProps) {
  const { t } = useT('settings');
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsDisconnecting(true);
      await onConfirm();

      toast({
        title: t('integrations.disconnectedSuccessfully', {
          provider: 'Shopify',
        }),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: t('integrations.disconnectionFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.failedToDisconnect', { provider: 'Shopify' }),
        variant: 'destructive',
      });

      setIsDisconnecting(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.disconnectConfirm', { provider: 'Shopify' })}
      confirmText={t('integrations.shopify.yesDisconnect')}
      loadingText={t('integrations.disconnecting')}
      isLoading={isDisconnecting}
      onConfirm={handleConfirm}
      variant="destructive"
    >
      <Stack gap={3}>
        {domain && (
          <Stack gap={1}>
            <p className="text-foreground text-sm font-medium">
              {t('integrations.shopify.connectedStore')}
            </p>
            <p className="text-muted-foreground text-sm">{domain}</p>
          </Stack>
        )}

        <Stack gap={2}>
          <p className="text-foreground text-sm">
            {t('integrations.shopify.disconnectQuestion')}
          </p>

          <div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
            <p className="text-destructive text-sm">
              {t('integrations.shopify.disconnectWarning')}
            </p>
          </div>
        </Stack>
      </Stack>
    </ConfirmDialog>
  );
}
