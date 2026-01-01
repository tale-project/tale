'use client';

import { useState } from 'react';
import { ViewDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Stack, HStack } from '@/components/ui/layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { OutlookIcon } from '@/components/ui/icons';
import { Plus, Trash2, MoreVertical, TestTube, Star, Shield } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/hooks/use-toast';
import { OutlookCreateProviderDialog } from './outlook-create-provider-dialog';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { EmailProviderDoc } from '@/convex/model/email_providers/types';
import { useDeleteEmailProvider } from '../hooks/use-delete-email-provider';
import { useTestEmailProvider } from '../hooks/use-test-email-provider';
import { useGenerateOAuthUrl } from '../hooks/use-generate-oauth-url';
import { useDateFormat } from '@/hooks/use-date-format';
import { useT } from '@/lib/i18n';

interface OutlookIntegrationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
}

export function OutlookIntegrationDialog({
  open,
  onOpenChange,
  organizationId,
}: OutlookIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { formatDate } = useDateFormat();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );

  // Fetch Outlook providers using Convex
  const allProvidersData = useQuery(
    api.email_providers.list,
    organizationId ? { organizationId: organizationId as string } : 'skip',
  );
  const allProviders: EmailProviderDoc[] = allProvidersData ?? [];

  // Filter for Outlook providers only
  const providers = allProviders.filter((p) => p.vendor === 'outlook');
  const isLoading = allProvidersData === undefined;

  // Convex mutations and actions
  const deleteProvider = useDeleteEmailProvider();
  const testExistingProvider = useTestEmailProvider();
  const generateAuthUrl = useGenerateOAuthUrl();

  const handleCreateProvider = () => {
    setShowCreateDialog(true);
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
          description: t('integrations.allTestsPassed', { smtp: result.smtp.latencyMs, imap: result.imap.latencyMs }),
          variant: 'success',
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

  const handleAuthorize = async (providerId: string) => {
    try {
      // Pass the current origin to preserve the hostname (localhost vs 127.0.0.1)
      const redirectUri = `${window.location.origin}/api/auth/oauth2/callback`;
      const authUrl = await generateAuthUrl({
        emailProviderId: providerId as Id<'emailProviders'>,
        organizationId: organizationId as string,
        redirectUri,
      });

      // Redirect to OAuth2 authorization
      window.location.href = authUrl;
    } catch (error) {
      console.error('Failed to generate auth URL:', error);
      toast({
        title: t('integrations.failedToStartAuth'),
        variant: 'destructive',
      });
    }
  };

  const footer = (
    <Button onClick={handleCreateProvider} className="w-full">
      <Plus className="size-4 mr-2" />
      {t('integrations.addOutlookProvider')}
    </Button>
  );

  return (
    <>
      <ViewDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('integrations.outlookIntegration')}
        customFooter={footer}
      >
        {isLoading ? (
          <Stack gap={3}>
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-16 bg-secondary/20 rounded-lg animate-pulse"
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
                  <h3 className="font-medium text-base text-foreground mb-1">
                    {provider.name}
                  </h3>
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
                        {provider.authMethod === 'oauth2' &&
                          !provider.oauth2Auth?.accessTokenEncrypted && (
                            <DropdownMenuItem
                              onClick={() => handleAuthorize(provider._id)}
                              className="text-blue-600 focus:text-blue-600"
                            >
                              <Shield className="mr-2 size-4" />
                              {t('integrations.authorize')}
                            </DropdownMenuItem>
                          )}
                        <DropdownMenuItem
                          onClick={() => handleTestConnection(provider._id)}
                          disabled={
                            testingProviderId === provider._id ||
                            (provider.authMethod === 'oauth2' &&
                              !provider.oauth2Auth?.accessTokenEncrypted)
                          }
                        >
                          <TestTube className="mr-2 size-4" />
                          {testingProviderId === provider._id
                            ? t('integrations.testing')
                            : t('integrations.test')}
                        </DropdownMenuItem>
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
                  {provider.authMethod === 'oauth2' ? (
                    <>
                      <Badge variant="outline" className="text-xs">
                        {t('integrations.oauth2')}
                      </Badge>
                      {!provider.oauth2Auth?.accessTokenEncrypted && (
                        <Badge variant="destructive" className="text-xs">
                          {t('integrations.notAuthorized')}
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      {t('integrations.password')}
                    </Badge>
                  )}
                  {provider.smtpConfig && (
                    <Badge variant="outline" className="text-xs">
                      {t('integrations.smtp')}
                    </Badge>
                  )}
                  {provider.imapConfig && (
                    <Badge variant="outline" className="text-xs">
                      {t('integrations.imap')}
                    </Badge>
                  )}
                </HStack>

                {/* Technical Details */}
                <Stack gap={1} className="mb-3 text-xs text-muted-foreground">
                  {provider.smtpConfig && (
                    <div>
                      {t('integrations.smtp')}: {provider.smtpConfig.host}:
                      {provider.smtpConfig.port} (
                      {provider.smtpConfig.secure ? t('integrations.ssl') : t('integrations.tls')})
                    </div>
                  )}
                  {provider.imapConfig && (
                    <div>
                      {t('integrations.imap')}: {provider.imapConfig.host}:
                      {provider.imapConfig.port} (
                      {provider.imapConfig.secure ? t('integrations.ssl') : t('integrations.tls')})
                    </div>
                  )}
                </Stack>

                {/* Footer */}
                <HStack justify="between" className="text-xs text-muted-foreground">
                  <span>
                    {t('integrations.created')}:{' '}
                    {formatDate(new Date(provider._creationTime), 'short')}
                  </span>
                </HStack>
              </div>
            ))}
          </Stack>
        ) : (
          <div className="text-center py-8">
            <OutlookIcon className="size-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground mb-2">
              {t('integrations.noOutlookProviders')}
            </p>
          </div>
        )}
      </ViewDialog>

      {/* Create Provider Dialog */}
      <OutlookCreateProviderDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        organizationId={organizationId}
        onSuccess={() => {
          setShowCreateDialog(false);
        }}
      />
    </>
  );
}
