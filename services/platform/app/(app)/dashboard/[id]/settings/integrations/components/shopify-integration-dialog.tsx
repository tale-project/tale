'use client';

import { useState, useEffect } from 'react';
import { FormDialog } from '@/components/ui/dialog';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { Description } from '@/components/ui/description';
import { Stack } from '@/components/ui/layout';
import { toast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.shopifyIntegration')}
      customFooter={footer}
      isSubmitting={isSubmitting}
    >
      {isConnected && (
        <StatusIndicator variant="success">
          {t('integrations.shopify.connectedToShopify')}
        </StatusIndicator>
      )}

      <Stack gap={3}>
        <Input
          id="shopify-domain"
          label={t('integrations.domain')}
          placeholder={t('integrations.shopify.domainPlaceholder')}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={isSubmitting}
          className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
        />
        <Description className="text-xs leading-[20px]">
          {t('integrations.shopify.domainHelp')}
          <br />
          {t('integrations.shopify.domainHelpNav')}
        </Description>
      </Stack>

      <Stack gap={3}>
        <Input
          id="shopify-access-token"
          type="password"
          label={t('integrations.accessToken')}
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
        <Description className="text-xs leading-[20px]">
          {t('integrations.shopify.accessTokenHelp')}
          <br />
          {t('integrations.shopify.accessTokenHelpNav')}
        </Description>
      </Stack>
    </FormDialog>
  );
}
