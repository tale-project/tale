'use client';

import { useState } from 'react';
import { ViewModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GmailIcon } from '@/components/ui/icons';
import {
  Plus,
  Trash2,
  MoreVertical,
  TestTube,
  Star,
  Shield,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import GmailCreateProviderDialog from './gmail-create-provider-dialog';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import {
  useDeleteEmailProvider,
  useTestEmailProvider,
  useGenerateOAuthUrl,
} from '../hooks';
import { useDateFormat } from '@/hooks/use-date-format';
import { useT } from '@/lib/i18n';

interface GmailIntegrationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
}

export default function GmailIntegrationDialog({
  open,
  onOpenChange,
  organizationId,
}: GmailIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { formatDate } = useDateFormat();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );

  // Fetch Gmail providers using Convex
  const allProviders = useQuery(
    api.email_providers.list,
    organizationId ? { organizationId: organizationId as string } : 'skip',
  );

  // Filter for Gmail providers only
  const providers = allProviders?.filter((p) => p.vendor === 'gmail') || [];
  const isLoading = allProviders === undefined;

  const deleteProvider = useDeleteEmailProvider();
  const testExistingProvider = useTestEmailProvider();
  const generateAuthUrl = useGenerateOAuthUrl();

  const handleCreateProvider = () => {
    setShowCreateModal(true);
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
      {t('integrations.addGmailProvider')}
    </Button>
  );

  return (
    <>
      <ViewModal
        open={open}
        onOpenChange={onOpenChange}
        title={t('integrations.gmailIntegration')}
        customFooter={footer}
      >
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-16 bg-secondary/20 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : providers && providers.length > 0 ? (
          <div className="space-y-3">
            {providers.map((provider) => (
              <div
                key={provider._id}
                className="bg-card border border-border rounded-lg p-4"
              >
                {/* Header Row */}
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-medium text-base text-foreground mb-1">
                    {provider.name}
                  </h3>
                  <div className="flex items-center gap-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0"
                        >
                          <span className="sr-only">{t('integrations.moreOptions')}</span>
                          <MoreVertical className="size-4" />
                        </Button>
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
                  </div>
                </div>

                {/* Badges Row */}
                <div className="flex items-center gap-2 mb-3">
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
                </div>

                {/* Technical Details */}
                <div className="space-y-1 mb-3 text-xs text-muted-foreground">
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
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {t('integrations.created')}:{' '}
                    {formatDate(new Date(provider._creationTime), 'short')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <GmailIcon className="size-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground mb-2">
              {t('integrations.noGmailProviders')}
            </p>
          </div>
        )}
      </ViewModal>

      {/* Create Provider Modal */}
      <GmailCreateProviderDialog
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        organizationId={organizationId}
        onSuccess={() => {
          setShowCreateModal(false);
        }}
      />
    </>
  );
}
