'use client';

import { useState, useEffect } from 'react';
import { FormModal } from '@/components/ui/modals';
import { toast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface ShopifyIntegrationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  credentials?: {
    domain?: string;
    accessToken?: string;
  } | null;
  onConnect: (data: {
    domain: string;
    accessToken: string;
  }) => Promise<void> | void;
  onDisconnect?: () => Promise<void> | void;
}

export default function ShopifyIntegrationDialog({
  open,
  onOpenChange,
  credentials,
  onConnect,
  onDisconnect,
}: ShopifyIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [domain, setDomain] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isConnected = !!credentials?.domain;

  // Initialize form with existing credentials
  useEffect(() => {
    if (credentials?.domain) {
      setDomain(credentials.domain);
    }
  }, [credentials]);

  const handleConnect = async () => {
    setIsSubmitting(true);
    try {
      await onConnect({ domain, accessToken });
      // Don't clear on success if updating
      if (!isConnected) {
        setDomain('');
        setAccessToken('');
      }
      // Close dialog
      onOpenChange?.(false);

      toast({
        title: isConnected ? t('integrations.updateSuccessful') : t('integrations.connectionSuccessful'),
        description: isConnected
          ? t('integrations.connectedTo', { provider: 'Shopify' })
          : t('integrations.connectedTo', { provider: 'Shopify' }),
        variant: 'success',
      });
    } catch {
      // Keep dialog open and surface error without leaking credentials
      toast({
        title: isConnected ? t('integrations.updateFailed') : t('integrations.connectionTestFailed'),
        description: t('integrations.failedToDisconnect', { provider: 'Shopify' }),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;

    setIsSubmitting(true);
    try {
      await onDisconnect();
      setDomain('');
      setAccessToken('');
      onOpenChange?.(false);
    } catch {
      toast({
        title: t('integrations.disconnectionFailed'),
        description: t('integrations.failedToDisconnect', { provider: 'Shopify' }),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = isConnected && onDisconnect ? (
    <>
      <Button
        variant="destructive"
        onClick={handleDisconnect}
        disabled={isSubmitting}
        className="flex-1"
      >
        {isSubmitting ? t('integrations.disconnecting') : t('integrations.disconnect')}
      </Button>
      <Button
        onClick={handleConnect}
        disabled={isSubmitting || !domain || !accessToken}
        className="flex-1"
      >
        {isSubmitting ? t('integrations.shopify.updating') : t('integrations.shopify.update')}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="outline"
        className="flex-1"
        onClick={() => onOpenChange?.(false)}
      >
        {tCommon('actions.cancel')}
      </Button>
      <Button
        onClick={handleConnect}
        className="flex-1"
        disabled={isSubmitting || !domain || !accessToken}
      >
        {isSubmitting ? t('integrations.shopify.connecting') : t('integrations.shopify.connect')}
      </Button>
    </>
  );

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.shopifyIntegration')}
      customFooter={footer}
      isSubmitting={isSubmitting}
    >
      {isConnected && (
        <div className="flex items-center space-x-2 text-sm text-green-600">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span>{t('integrations.shopify.connectedToShopify')}</span>
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-2">
          <Label
            htmlFor="shopify-domain"
            className="text-sm font-medium text-foreground/80"
          >
            {t('integrations.domain')}
          </Label>
          <Input
            id="shopify-domain"
            placeholder={t('integrations.shopify.domainPlaceholder')}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={isSubmitting}
            className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
          />
        </div>
        <p className="text-xs text-muted-foreground leading-[20px]">
          {t('integrations.shopify.domainHelp')}
          <br />
          {t('integrations.shopify.domainHelpNav')}
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label
            htmlFor="shopify-access-token"
            className="text-sm font-medium text-foreground/80"
          >
            {t('integrations.accessToken')}
          </Label>
          <Input
            id="shopify-access-token"
            type="password"
            placeholder={
              isConnected
                ? '••••••••••••••••'
                : 'shpat_1234567890abcdef1234567890abcdef'
            }
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            disabled={isSubmitting}
            className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
          />
        </div>
        <p className="text-xs text-muted-foreground leading-[20px]">
          {t('integrations.shopify.accessTokenHelp')}
          <br />
          {t('integrations.shopify.accessTokenHelpNav')}
        </p>
      </div>
    </FormModal>
  );
}
