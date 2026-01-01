'use client';

import { useState } from 'react';
import { ViewDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Stack, HStack, Center } from '@/components/ui/layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GmailIcon, OutlookIcon } from '@/components/ui/icons';
import { Plus, Trash2, MoreVertical, TestTube, Star, Mail } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/hooks/use-toast';
import { EmailProviderTypeSelector } from './email-provider-type-selector';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { EmailProviderDoc } from '@/convex/model/email_providers/types';
import { useDeleteEmailProvider } from '../hooks/use-delete-email-provider';
import { useSetDefaultProvider } from '../hooks/use-set-default-provider';
import { useTestEmailProvider } from '../hooks/use-test-email-provider';
import { useT } from '@/lib/i18n';

interface EmailIntegrationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
}

export function EmailIntegrationDialog({
  open,
  onOpenChange,
  organizationId,
}: EmailIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );

  // Fetch all email providers using Convex
  const providersData = useQuery(
    api.email_providers.list,
    organizationId ? { organizationId: organizationId as string } : 'skip',
  );
  const providers: EmailProviderDoc[] = providersData ?? [];

  const isLoading = providersData === undefined;

  const deleteProvider = useDeleteEmailProvider();
  const setDefaultProvider = useSetDefaultProvider();
  const testExistingProvider = useTestEmailProvider();

  const handleAddProvider = () => {
    setShowTypeSelector(true);
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProviderId(providerId);
    try {
      toast({
        title: t('integrations.testingConnection'),
        description: t('integrations.validatingCredentials'),
      });

      const result = await testExistingProvider({
        providerId: providerId as Id<'emailProviders'>,
      });

      if (result.success) {
        toast({
          title: t('integrations.connectionSuccessful'),
          variant: 'success',
          description: t('integrations.allTestsPassed', { smtp: result.smtp.latencyMs, imap: result.imap.latencyMs }),
        });
      } else {
        const errors = [];
        if (!result.smtp.success) {
          errors.push(`SMTP: ${result.smtp.error}`);
        }
        if (!result.imap.success) {
          errors.push(`IMAP: ${result.imap.error}`);
        }
        toast({
          title: t('integrations.connectionTestFailed'),
          description: errors.join('. '),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to test connection:', error);
      toast({
        title: t('integrations.failedToTestConnection'),
        variant: 'destructive',
      });
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await deleteProvider({
        providerId: providerId as Id<'emailProviders'>,
      });
    } catch (error) {
      console.error('Failed to delete provider:', error);
      toast({
        title: t('integrations.failedToDeleteProvider'),
        variant: 'destructive',
      });
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultProvider({
        providerId: providerId as Id<'emailProviders'>,
      });
      toast({
        title: t('integrations.defaultProviderUpdated'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to set default provider:', error);
      toast({
        title: t('integrations.failedToSetDefault'),
        variant: 'destructive',
      });
    }
  };

  const getVendorIcon = (vendor: string) => {
    switch (vendor) {
      case 'gmail':
        return <GmailIcon className="size-5" />;
      case 'outlook':
        return <OutlookIcon className="size-5" />;
      default:
        return <Mail className="size-5" />;
    }
  };

  const _getVendorName = (vendor: string) => {
    switch (vendor) {
      case 'gmail':
        return 'Gmail';
      case 'outlook':
        return 'Outlook';
      case 'smtp':
        return 'Custom SMTP';
      case 'resend':
        return 'Resend';
      default:
        return 'Other';
    }
  };

  const footer = (
    <Button onClick={handleAddProvider} className="w-full">
      <Plus className="size-4 mr-2" />
      {t('integrations.addEmailProvider')}
    </Button>
  );

  return (
    <>
      <ViewDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('integrations.emailIntegration')}
        customFooter={footer}
      >
        {isLoading ? (
          <Stack gap={3}>
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-32 bg-secondary/20 rounded-lg animate-pulse"
              />
            ))}
          </Stack>
        ) : providers && providers.length > 0 ? (
          <Stack gap={3}>
            {providers.map((provider) => (
              <div
                key={provider._id}
                className="bg-card border border-border rounded-lg p-4"
              >
                {/* Header Row */}
                <HStack align="start" justify="between" className="mb-3">
                  <HStack gap={2}>
                    {getVendorIcon(provider.vendor)}
                    <h3 className="font-medium text-base text-foreground">
                      {provider.name}
                    </h3>
                  </HStack>
                  <HStack gap={3}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          icon={MoreVertical}
                          aria-label={t('integrations.moreOptions')}
                          className="size-8"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleTestConnection(provider._id)}
                          disabled={testingProviderId === provider._id}
                        >
                          <TestTube className="mr-2 size-4" />
                          {testingProviderId === provider._id
                            ? t('integrations.testing')
                            : t('integrations.test')}
                        </DropdownMenuItem>
                        {!provider.isDefault && (
                          <DropdownMenuItem
                            onClick={() => handleSetDefault(provider._id)}
                          >
                            <Star className="mr-2 size-4" />
                            {t('integrations.setAsDefault')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleDeleteProvider(provider._id)}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="mr-2 size-4" />
                          {tCommon('actions.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </HStack>
                </HStack>

                {/* Badges Row */}
                <HStack gap={2} className="mb-3">
                  {provider.isDefault && (
                    <Badge
                      variant="orange"
                      className="[&>span]:flex [&>span]:items-center"
                    >
                      <Star className="size-3.5 mr-1" />
                      {t('integrations.default')}
                    </Badge>
                  )}
                  {provider.authMethod === 'oauth2' && (
                    <Badge variant="blue">{t('integrations.oauth2')}</Badge>
                  )}
                  {provider.sendMethod === 'api' && (
                    <Badge variant="blue">{t('integrations.apiSending')}</Badge>
                  )}
                </HStack>

                {/* Technical Details */}
                <Stack gap={1} className="text-xs text-muted-foreground">
                  {provider.authMethod === 'oauth2' &&
                    provider.metadata?.oauth2_user && (
                      <div>
                        <span className="font-medium">{t('integrations.account')}:</span>{' '}
                        {provider.metadata.oauth2_user as string}
                      </div>
                    )}
                  {provider.sendMethod && (
                    <div>
                      <span className="font-medium">{t('integrations.sendMethod')}:</span>{' '}
                      {provider.sendMethod === 'api'
                        ? t('integrations.apiGmailGraph')
                        : t('integrations.smtp')}
                    </div>
                  )}
                  {provider.smtpConfig && (
                    <div>
                      <span className="font-medium">{t('integrations.smtp')}:</span>{' '}
                      {provider.smtpConfig.host}:{provider.smtpConfig.port}{' '}
                      ({provider.smtpConfig.secure ? t('integrations.ssl') : t('integrations.tls')})
                    </div>
                  )}
                  {provider.imapConfig && (
                    <div>
                      <span className="font-medium">{t('integrations.imap')}:</span>{' '}
                      {provider.imapConfig.host}:{provider.imapConfig.port}{' '}
                      ({provider.imapConfig.secure ? t('integrations.ssl') : t('integrations.tls')})
                    </div>
                  )}
                  {provider.passwordAuth && (
                    <div>
                      <span className="font-medium">{t('integrations.user')}:</span>{' '}
                      {provider.passwordAuth.user}
                    </div>
                  )}
                </Stack>
              </div>
            ))}
          </Stack>
        ) : (
          <div className="text-center py-8">
            <Mail className="size-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground mb-2">
              {t('integrations.noProvidersYet')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('integrations.addProviderToStart')}
            </p>
          </div>
        )}
      </ViewDialog>

      {/* Provider Type Selector */}
      <EmailProviderTypeSelector
        open={showTypeSelector}
        onOpenChange={setShowTypeSelector}
        organizationId={organizationId}
        onSuccess={() => {
          setShowTypeSelector(false);
        }}
      />
    </>
  );
}
