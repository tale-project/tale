'use client';

import { useQuery } from 'convex/react';
import {
  Plus,
  Trash2,
  MoreVertical,
  TestTube,
  Star,
  Mail,
  KeyRound,
  Pencil,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useState } from 'react';

import type { Id, Doc } from '@/convex/_generated/dataModel';
import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { GmailIcon } from '@/app/components/icons/gmail-icon';
import { OutlookIcon } from '@/app/components/icons/outlook-icon';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Input } from '@/app/components/ui/forms/input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';

import { useDeleteEmailProvider } from '../hooks/use-delete-email-provider';
import { useGenerateOAuthUrl } from '../hooks/use-generate-oauth-url';
import { useSetDefaultProvider } from '../hooks/use-set-default-provider';
import { useSsoCredentials } from '../hooks/use-sso-credentials';
import { useTestEmailProvider } from '../hooks/use-test-email-provider';
import { useUpdateEmailProvider } from '../hooks/use-update-email-provider';
import { useUpdateOAuth2Provider } from '../hooks/use-update-oauth2-provider';
import { EmailProviderTypeSelector } from './email-provider-type-selector';

type EmailProviderDoc = Doc<'emailProviders'>;

interface EmailIntegrationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  ssoProvider?: SsoProvider | null;
}

export function EmailIntegrationDialog({
  open,
  onOpenChange,
  organizationId,
  ssoProvider,
}: EmailIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const siteUrl = useSiteUrl();
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );
  const [authorizingProviderId, setAuthorizingProviderId] = useState<
    string | null
  >(null);
  const [editingProvider, setEditingProvider] =
    useState<EmailProviderDoc | null>(null);
  const [editName, setEditName] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [editClientSecret, setEditClientSecret] = useState('');
  const [editTenantId, setEditTenantId] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSyncingSso, setIsSyncingSso] = useState(false);
  const [didSyncFromSso, setDidSyncFromSso] = useState(false);

  const providersData = useQuery(
    api.email_providers.queries.list,
    organizationId ? { organizationId } : 'skip',
  );
  const providers: EmailProviderDoc[] = providersData ?? [];

  const isLoading = providersData === undefined;

  const deleteProvider = useDeleteEmailProvider();
  const setDefaultProvider = useSetDefaultProvider();
  const testExistingProvider = useTestEmailProvider();
  const generateAuthUrl = useGenerateOAuthUrl();
  const updateProvider = useUpdateEmailProvider();
  const updateOAuth2Provider = useUpdateOAuth2Provider();
  const fetchSsoCredentials = useSsoCredentials();

  const hasSsoConfigured =
    !!ssoProvider && ssoProvider.providerId === 'entra-id';

  const handleAddProvider = () => {
    setShowTypeSelector(true);
  };

  const handleTestConnection = async (providerId: Id<'emailProviders'>) => {
    setTestingProviderId(providerId);
    try {
      toast({
        title: t('integrations.testingConnection'),
        description: t('integrations.validatingCredentials'),
      });

      const result = await testExistingProvider({
        providerId,
      });

      if (result.success) {
        toast({
          title: t('integrations.connectionSuccessful'),
          variant: 'success',
          description: t('integrations.allTestsPassed', {
            smtp: result.smtp.latencyMs,
            imap: result.imap.latencyMs,
          }),
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

  const handleDeleteProvider = async (providerId: Id<'emailProviders'>) => {
    try {
      await deleteProvider({
        providerId,
      });
    } catch (error) {
      console.error('Failed to delete provider:', error);
      toast({
        title: t('integrations.failedToDeleteProvider'),
        variant: 'destructive',
      });
    }
  };

  const handleSetDefault = async (providerId: Id<'emailProviders'>) => {
    try {
      await setDefaultProvider({
        providerId,
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
      setEditTenantId(
        typeof provider.metadata?.tenantId === 'string'
          ? provider.metadata.tenantId
          : '',
      );
    }
  };

  const handleCloseEditDialog = () => {
    setEditingProvider(null);
    setEditName('');
    setEditClientId('');
    setEditClientSecret('');
    setEditTenantId('');
    setDidSyncFromSso(false);
  };

  const hasEditChanges = () => {
    if (!editingProvider) return false;

    const nameChanged = editName.trim() !== editingProvider.name;

    if (editingProvider.authMethod === 'oauth2') {
      const clientIdChanged =
        editClientId !== (editingProvider.oauth2Auth?.clientId || '');
      const clientSecretChanged = editClientSecret.length > 0;
      const tenantIdChanged =
        editTenantId !==
        (typeof editingProvider.metadata?.tenantId === 'string'
          ? editingProvider.metadata.tenantId
          : '');
      return (
        nameChanged || clientIdChanged || clientSecretChanged || tenantIdChanged
      );
    }

    return nameChanged;
  };

  const handleUpdateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProvider || !editName.trim()) return;

    setIsUpdating(true);
    try {
      if (editingProvider.authMethod === 'oauth2') {
        const hasCredentialChanges =
          editClientId !== (editingProvider.oauth2Auth?.clientId || '') ||
          editClientSecret.length > 0;
        const tenantId =
          editingProvider.vendor === 'outlook' && editTenantId.trim()
            ? editTenantId.trim()
            : undefined;
        await updateOAuth2Provider({
          providerId: editingProvider._id,
          name: editName.trim(),
          clientId: editClientId || undefined,
          clientSecret: editClientSecret || undefined,
          tenantId,
          credentialsSource: hasCredentialChanges
            ? didSyncFromSso
              ? 'sso'
              : 'manual'
            : undefined,
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

  const handleSyncFromSso = async () => {
    if (!editingProvider || !hasSsoConfigured) return;

    setIsSyncingSso(true);
    try {
      const credentials = await fetchSsoCredentials({ organizationId });
      if (credentials) {
        setEditClientId(credentials.clientId);
        setEditClientSecret(credentials.clientSecret);
        setEditTenantId(credentials.tenantId);
        setDidSyncFromSso(true);
        toast({
          title: t('integrations.syncFromSsoSuccess'),
          variant: 'success',
        });
      } else {
        toast({
          title: t('integrations.failedToLoadSsoCredentials'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to sync SSO credentials:', error);
      toast({
        title: t('integrations.failedToLoadSsoCredentials'),
        variant: 'destructive',
      });
    } finally {
      setIsSyncingSso(false);
    }
  };

  const handleAuthorize = async (providerId: Id<'emailProviders'>) => {
    setAuthorizingProviderId(providerId);
    try {
      toast({
        title: t('integrations.authorizingProvider'),
      });

      const redirectUri = `${siteUrl}/api/auth/oauth2/callback`;
      const result = await generateAuthUrl({
        emailProviderId: providerId,
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
      <Plus className="mr-2 size-4" />
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
                className="bg-secondary/20 h-32 animate-pulse rounded-lg"
              />
            ))}
          </Stack>
        ) : providers && providers.length > 0 ? (
          <Stack gap={3}>
            {providers.map((provider) => (
              <div
                key={provider._id}
                className="bg-card border-border rounded-lg border p-4"
              >
                <HStack align="start" justify="between" className="mb-3">
                  <HStack gap={2}>
                    {getVendorIcon(provider.vendor)}
                    <h3 className="text-foreground text-base font-medium">
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

                {provider.status === 'pending_authorization' && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <HStack justify="between" align="center" gap={3}>
                      <HStack gap={2} align="center">
                        <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
                          <KeyRound className="size-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-amber-800">
                            {t('integrations.authorizationRequired')}
                          </p>
                          <p className="text-xs text-amber-700">
                            {t('integrations.authorizationRequiredDescription')}
                          </p>
                        </div>
                      </HStack>
                      <Button
                        size="sm"
                        onClick={() => handleAuthorize(provider._id)}
                        disabled={authorizingProviderId === provider._id}
                        className="flex-shrink-0"
                      >
                        {authorizingProviderId === provider._id ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <KeyRound className="mr-1.5 size-3.5" />
                        )}
                        {t('integrations.authorize')}
                      </Button>
                    </HStack>
                  </div>
                )}

                <HStack gap={2} className="mb-3 flex-wrap">
                  {provider.isDefault && (
                    <Badge
                      variant="orange"
                      className="[&>span]:flex [&>span]:items-center"
                    >
                      <Star className="mr-1 size-3.5" />
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

                <Stack gap={1} className="text-muted-foreground text-xs">
                  {provider.authMethod === 'oauth2' &&
                    provider.metadata?.oauth2_user && (
                      <div>
                        <span className="font-medium">
                          {t('integrations.account')}:
                        </span>{' '}
                        {typeof provider.metadata.oauth2_user === 'string'
                          ? provider.metadata.oauth2_user
                          : ''}
                      </div>
                    )}
                  {provider.sendMethod && (
                    <div>
                      <span className="font-medium">
                        {t('integrations.sendMethod')}:
                      </span>{' '}
                      {provider.sendMethod === 'api'
                        ? t('integrations.apiGmailGraph')
                        : t('integrations.smtp')}
                    </div>
                  )}
                  {provider.smtpConfig && (
                    <div>
                      <span className="font-medium">
                        {t('integrations.smtp')}:
                      </span>{' '}
                      {provider.smtpConfig.host}:{provider.smtpConfig.port} (
                      {provider.smtpConfig.secure
                        ? t('integrations.ssl')
                        : t('integrations.tls')}
                      )
                    </div>
                  )}
                  {provider.imapConfig && (
                    <div>
                      <span className="font-medium">
                        {t('integrations.imap')}:
                      </span>{' '}
                      {provider.imapConfig.host}:{provider.imapConfig.port} (
                      {provider.imapConfig.secure
                        ? t('integrations.ssl')
                        : t('integrations.tls')}
                      )
                    </div>
                  )}
                  {provider.passwordAuth && (
                    <div>
                      <span className="font-medium">
                        {t('integrations.user')}:
                      </span>{' '}
                      {provider.passwordAuth.user}
                    </div>
                  )}
                </Stack>
              </div>
            ))}
          </Stack>
        ) : (
          <div className="py-8 text-center">
            <Mail className="mx-auto mb-2 size-8 opacity-50" />
            <p className="text-muted-foreground mb-2 text-sm">
              {t('integrations.noProvidersYet')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('integrations.addProviderToStart')}
            </p>
          </div>
        )}
      </ViewDialog>

      <EmailProviderTypeSelector
        open={showTypeSelector}
        onOpenChange={setShowTypeSelector}
        organizationId={organizationId}
        ssoProvider={ssoProvider}
        onSuccess={() => {
          setShowTypeSelector(false);
        }}
      />

      <FormDialog
        open={!!editingProvider}
        onOpenChange={(open) => !open && handleCloseEditDialog()}
        title={t('integrations.editProvider')}
        isSubmitting={isUpdating}
        onSubmit={handleUpdateProvider}
        submitText={tCommon('actions.save')}
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
              {editingProvider.vendor === 'outlook' &&
                hasSsoConfigured &&
                editingProvider.metadata?.credentialsSource === 'sso' && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-2.5">
                    <HStack justify="between" align="center">
                      <div>
                        <p className="text-xs font-medium text-green-800">
                          {t('integrations.credentialsFromSso')}
                        </p>
                        <p className="text-xs text-green-700">
                          {t('integrations.useSsoCredentialsDescription')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSyncFromSso}
                        disabled={isSyncingSso}
                      >
                        {isSyncingSso ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 size-3.5" />
                        )}
                        {t('integrations.syncFromSso')}
                      </Button>
                    </HStack>
                  </div>
                )}
              <Input
                id="edit-client-id"
                label={
                  editingProvider.vendor === 'outlook'
                    ? t('integrations.microsoftClientId')
                    : t('integrations.googleClientId')
                }
                value={editClientId}
                onChange={(e) => setEditClientId(e.target.value)}
                placeholder={
                  editingProvider.vendor === 'outlook'
                    ? t('integrations.microsoftClientIdPlaceholder')
                    : t('integrations.googleClientIdPlaceholder')
                }
              />
              <Input
                id="edit-client-secret"
                type="password"
                label={
                  editingProvider.vendor === 'outlook'
                    ? t('integrations.microsoftClientSecret')
                    : t('integrations.googleClientSecret')
                }
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
