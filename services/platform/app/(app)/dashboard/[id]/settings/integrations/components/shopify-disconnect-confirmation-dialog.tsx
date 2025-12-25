'use client';

import { useState } from 'react';
import { ConfirmModal } from '@/components/ui/modals';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

interface ShopifyDisconnectConfirmationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  domain?: string;
  onConfirm: () => Promise<void> | void;
}

export default function ShopifyDisconnectConfirmationDialog({
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
        title: t('integrations.disconnectedSuccessfully', { provider: 'Shopify' }),
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
    <ConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.disconnectConfirm', { provider: 'Shopify' })}
      confirmText={t('integrations.shopify.yesDisconnect')}
      loadingText={t('integrations.disconnecting')}
      isLoading={isDisconnecting}
      onConfirm={handleConfirm}
      variant="destructive"
    >
      <div className="space-y-3">
        {domain && (
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {t('integrations.shopify.connectedStore')}
            </p>
            <p className="text-sm text-muted-foreground">{domain}</p>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm text-foreground">
            {t('integrations.shopify.disconnectQuestion')}
          </p>

          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm text-destructive">
              {t('integrations.shopify.disconnectWarning')}
            </p>
          </div>
        </div>
      </div>
    </ConfirmModal>
  );
}
