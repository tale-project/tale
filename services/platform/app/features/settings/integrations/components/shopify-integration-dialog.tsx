'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { StatusIndicator } from '@/app/components/ui/feedback/status-indicator';
import { Input } from '@/app/components/ui/forms/input';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

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

type ShopifyFormValues = {
  domain: string;
  accessToken: string;
};

export function ShopifyIntegrationDialog({
  open,
  onOpenChange,
  credentials,
  onConnect,
  onDisconnect,
}: ShopifyIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isConnected = !!credentials?.domain;

  const shopifySchema = useMemo(
    () =>
      z.object({
        domain: z.string().min(1, t('integrations.shopify.domainRequired')),
        accessToken: z
          .string()
          .min(1, t('integrations.shopify.accessTokenRequired')),
      }),
    [t],
  );

  const {
    register,
    handleSubmit: formHandleSubmit,
    reset,
    formState: { isValid: isFormValid, errors },
  } = useForm<ShopifyFormValues>({
    resolver: zodResolver(shopifySchema),
    mode: 'onChange',
    defaultValues: {
      domain: credentials?.domain || '',
      accessToken: '',
    },
  });

  useEffect(() => {
    if (credentials?.domain) {
      reset({
        domain: credentials.domain,
        accessToken: '',
      });
    }
  }, [credentials, reset]);

  const handleConnect = async (values: ShopifyFormValues) => {
    setIsSubmitting(true);
    try {
      await onConnect(values);
      if (!isConnected) {
        reset();
      }
      onOpenChange?.(false);

      toast({
        title: isConnected
          ? t('integrations.updateSuccessful')
          : t('integrations.connectionSuccessful'),
        description: t('integrations.connectedTo', { provider: 'Shopify' }),
        variant: 'success',
      });
    } catch {
      toast({
        title: isConnected
          ? t('integrations.updateFailed')
          : t('integrations.connectionTestFailed'),
        description: t('integrations.failedToDisconnect', {
          provider: 'Shopify',
        }),
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
      reset();
      onOpenChange?.(false);
    } catch {
      toast({
        title: t('integrations.disconnectionFailed'),
        description: t('integrations.failedToDisconnect', {
          provider: 'Shopify',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer =
    isConnected && onDisconnect ? (
      <>
        <Button
          variant="destructive"
          onClick={handleDisconnect}
          disabled={isSubmitting}
          className="flex-1"
        >
          {isSubmitting
            ? t('integrations.disconnecting')
            : t('integrations.disconnect')}
        </Button>
        <Button
          onClick={formHandleSubmit(handleConnect)}
          disabled={isSubmitting || !isFormValid}
          className="flex-1"
        >
          {isSubmitting
            ? t('integrations.shopify.updating')
            : t('integrations.shopify.update')}
        </Button>
      </>
    ) : (
      <>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => onOpenChange?.(false)}
        >
          {tCommon('actions.cancel')}
        </Button>
        <Button
          onClick={formHandleSubmit(handleConnect)}
          className="flex-1"
          disabled={isSubmitting || !isFormValid}
        >
          {isSubmitting
            ? t('integrations.shopify.connecting')
            : t('integrations.shopify.connect')}
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

      <Input
        id="shopify-domain"
        label={t('integrations.domain')}
        description={
          <>
            {t('integrations.shopify.domainHelp')}
            <br />
            {t('integrations.shopify.domainHelpNav')}
          </>
        }
        placeholder={t('integrations.shopify.domainPlaceholder')}
        {...register('domain')}
        disabled={isSubmitting}
        errorMessage={errors.domain?.message}
        className="border-gray-300 shadow-xs"
      />

      <Input
        id="shopify-access-token"
        type="password"
        label={t('integrations.accessToken')}
        description={
          <>
            {t('integrations.shopify.accessTokenHelp')}
            <br />
            {t('integrations.shopify.accessTokenHelpNav')}
          </>
        }
        placeholder={
          isConnected
            ? '••••••••••••••••'
            : 'shpat_1234567890abcdef1234567890abcdef'
        }
        {...register('accessToken')}
        disabled={isSubmitting}
        errorMessage={errors.accessToken?.message}
        className="border-gray-300 shadow-xs"
      />
    </FormDialog>
  );
}
