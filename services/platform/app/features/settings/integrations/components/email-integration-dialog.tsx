'use client';

import { useState } from 'react';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Input } from '@/app/components/ui/forms/input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/overlays/dropdown-menu';
import { GmailIcon } from '@/app/components/icons/gmail-icon';
import { OutlookIcon } from '@/app/components/icons/outlook-icon';
import { Plus, Trash2, MoreVertical, TestTube, Star, Mail, KeyRound, Pencil } from 'lucide-react';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { toast } from '@/app/hooks/use-toast';
import { EmailProviderTypeSelector } from './email-provider-type-selector';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id, Doc } from '@/convex/_generated/dataModel';

type EmailProviderDoc = Doc<'emailProviders'>;
import { useDeleteEmailProvider } from '../hooks/use-delete-email-provider';
import { useSetDefaultProvider } from '../hooks/use-set-default-provider';
import { useTestEmailProvider } from '../hooks/use-test-email-provider';
import { useGenerateOAuthUrl } from '../hooks/use-generate-oauth-url';
import { useUpdateEmailProvider } from '../hooks/use-update-email-provider';
import { useUpdateOAuth2Provider } from '../hooks/use-update-oauth2-provider';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';

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
  const siteUrl = useSiteUrl();
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );
  const [authorizingProviderId, setAuthorizingProviderId] = useState<string | null>(
    null,
  );
  const [editingProvider, setEditingProvider] = useState<EmailProviderDoc | null>(null);
  const [editName, setEditName] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [editClientSecret, setEditClientSecret] = useState('');
  const [editTenantId, setEditTenantId] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Fetch all email providers using Convex
  const providersData = useQuery(
    api.email_providers.queries.list,
    organizationId ? { organizationId: organizationId as string } : 'skip',
  );
  const providers: EmailProviderDoc[] = providersData ?? [];

  const isLoading = providersData === undefined;

  const deleteProvider = useDeleteEmailProvider();
  const setDefaultProvider = useSetDefaultProvider();
  const testExistingProvider = useTestEmailProvider();
  const generateAuthUrl = useGenerateOAuthUrl();
  const updateProvider = useUpdateEmailProvider();
  const updateOAuth2Provider = useUpdateOAuth2Provider();

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

  const handleEditProvider = (provider: EmailProviderDoc) => {
    setEditingProvider(provider);
    setEditName(provider.name);
    if (provider.authMethod === 'oauth2' && provider.oauth2Auth) {
      setEditClientId(provider.oauth2Auth.clientId || '');
      setEditClientSecret('');
      setEditTenantId((provider.metadata?.tenantId as string) || '');
    }
  };

  const handleCloseEditDialog = () => {
    setEditingProvider(null);
    setEditName('');
    setEditClientId('');
    setEditClientSecret('');
    setEditTenantId('');
  };

  const hasEditChanges = () => {
    if (!editingProvider) return false;

    const nameChanged = editName.trim() !== editingProvider.name;

    if (editingProvider.authMethod === 'oauth2') {
      const clientIdChanged = editClientId !== (editingProvider.oauth2Auth?.clientId || '');
      const clientSecretChanged = editClientSecret.length > 0;
      const tenantIdChanged = editTenantId !== ((editingProvider.metadata?.tenantId as string) || '');
      return nameChanged || clientIdChanged || clientSecretChanged || tenantIdChanged;
    }

    return nameChanged;
  };

  const handleUpdateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProvider || !editName.trim()) return;

    setIsUpdating(true);
    try {
      if (editingProvider.authMethod === 'oauth2') {
        await updateOAuth2Provider({
          providerId: editingProvider._id,
          name: editName.trim(),
          clientId: editClientId || undefined,
          clientSecret: editClientSecret || undefined,
          tenantId: editTenantId,
        });
      } else {
        await updateProvider({
          providerId: editingProvider._id,
          name: editName.trim(),
        });
      }
      toast({
        title: t('integrations.providerUpdated'),
        variant: 'success',
      });
      handleCloseEditDialog();
    } catch (error) {
      console.error('Failed to update provider:', error);
      toast({
        title: t('integrations.failedToUpdateProvider'),
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAuthorize = async (providerId: string) => {
    setAuthorizingProviderId(providerId);
    try {
      toast({
        title: t('integrations.authorizingProvider'),
      });

      const redirectUri = `${siteUrl}/api/auth/oauth2/callback`;
      const result = await generateAuthUrl({
        emailProviderId: providerId as Id<'emailProviders'>,
        organizationId: organizationId,
        redirectUri,
      });

      window.location.href = result.authUrl;
    } catch (error) {
      console.error('Failed to start authorization:', error);
      toast({
        title: t('integrations.failedToStartAuth'),
        variant: 'destructive',
      });
      setAuthorizingProviderId(null);
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

  const footer = (
    <Button onClick={handleAddProvider} fullWidth>
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
                        {provider.status === 'pending_authorization' && (
                          <DropdownMenuItem
                            onClick={() => handleAuthorize(provider._id)}
                            disabled={authorizingProviderId === provider._id}
                          >
                            <KeyRound className="mr-2 size-4" />
                            {authorizingProviderId === provider._id
                              ? t('integrations.authorizingProvider')
                              : t('integrations.authorize')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleEditProvider(provider)}
                        >
                          <Pencil className="mr-2 size-4" />
                          {tCommon('actions.edit')}
                        </DropdownMenuItem>
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
                <HStack gap={2} className="mb-3 flex-wrap">
                  {provider.isDefault && (
                    <Badge
                      variant="orange"
                      className="[&>span]:flex [&>span]:items-center"
                    >
                      <Star className="size-3.5 mr-1" />
                      {t('integrations.default')}
                    </Badge>
                  )}
                  {provider.status === 'pending_authorization' && (
                    <Badge
                      variant="yellow"
                      className="[&>span]:flex [&>span]:items-center"
                    >
                      <KeyRound className="size-3.5 mr-1" />
                      {t('integrations.pendingAuthorization')}
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

      {/* Edit Provider Dialog */}
      <FormDialog
        open={!!editingProvider}
        onOpenChange={(open) => !open && handleCloseEditDialog()}
        title={t('integrations.editProvider')}
        isSubmitting={isUpdating}
        onSubmit={handleUpdateProvider}
        submitLabel={tCommon('actions.save')}
        submitDisabled={!hasEditChanges()}
      >
        <Stack gap={3}>
          <Input
            id="edit-name"
            label={t('integrations.providerName')}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder={t('integrations.providerNamePlaceholder')}
          />
          {editingProvider?.authMethod === 'oauth2' && (
            <>
              <Input
                id="edit-client-id"
                label={editingProvider.vendor === 'outlook'
                  ? t('integrations.microsoftClientId')
                  : t('integrations.googleClientId')}
                value={editClientId}
                onChange={(e) => setEditClientId(e.target.value)}
                placeholder={editingProvider.vendor === 'outlook'
                  ? t('integrations.microsoftClientIdPlaceholder')
                  : t('integrations.googleClientIdPlaceholder')}
              />
              <Input
                id="edit-client-secret"
                type="password"
                label={editingProvider.vendor === 'outlook'
                  ? t('integrations.microsoftClientSecret')
                  : t('integrations.googleClientSecret')}
                value={editClientSecret}
                onChange={(e) => setEditClientSecret(e.target.value)}
                placeholder={t('integrations.leaveEmptyToKeep')}
              />
              {editingProvider.vendor === 'outlook' && (
                <Input
                  id="edit-tenant-id"
                  label={t('integrations.microsoftTenantId')}
                  value={editTenantId}
                  onChange={(e) => setEditTenantId(e.target.value)}
                  placeholder={t('integrations.microsoftTenantIdPlaceholder')}
                />
              )}
            </>
          )}
        </Stack>
      </FormDialog>
    </>
  );
}
