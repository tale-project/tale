'use client';

import { useState, useMemo, useEffect } from 'react';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { Input } from '@/app/components/ui/forms/input';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/navigation/tabs';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { OutlookIcon } from '@/app/components/icons/outlook-icon';
import { ExternalLink, Shield, Key, Loader2 } from 'lucide-react';
import { toast } from '@/app/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';
import { useCreateEmailProvider } from '../hooks/use-create-email-provider';
import { useCreateOAuth2Provider } from '../hooks/use-create-oauth2-provider';
import { useTestEmailConnection } from '../hooks/use-test-email-connection';
import { useSsoCredentials } from '../hooks/use-sso-credentials';
import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

type PasswordFormData = {
  name: string;
  email: string;
  password: string;
  isDefault: boolean;
};

type OAuth2FormData = {
  name: string;
  isDefault: boolean;
  useApiSending: boolean;
  clientId: string;
  clientSecret: string;
  tenantId: string;
};

type AuthMethod = 'oauth2' | 'password';

interface OutlookCreateProviderDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess: () => void;
  ssoProvider?: SsoProvider | null;
}

export function OutlookCreateProviderDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
  ssoProvider,
}: OutlookCreateProviderDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const siteUrl = useSiteUrl();

  const [useSsoCredentialsChecked, setUseSsoCredentialsChecked] = useState(false);
  const [isLoadingSsoCredentials, setIsLoadingSsoCredentials] = useState(false);
  const fetchSsoCredentials = useSsoCredentials();

  const hasSsoConfigured = !!ssoProvider && ssoProvider.providerId === 'entra-id';

  const passwordSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, tCommon('validation.required', { field: t('integrations.providerName') })),
        email: z.string().email(tCommon('validation.email')),
        password: z.string().min(1, tCommon('validation.required', { field: t('integrations.appPassword') })),
        isDefault: z.boolean(),
      }),
    [t, tCommon],
  );

  const oauth2Schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, tCommon('validation.required', { field: t('integrations.providerName') })),
        isDefault: z.boolean(),
        useApiSending: z.boolean(),
        clientId: z.string().min(1, tCommon('validation.required', { field: t('integrations.microsoftClientId') })),
        clientSecret: z.string().min(1, tCommon('validation.required', { field: t('integrations.microsoftClientSecret') })),
        tenantId: z.string(),
      }),
    [t, tCommon],
  );

  const [authMethod, setAuthMethod] = useState<AuthMethod>('oauth2');
  const [isLoading, setIsLoading] = useState(false);

  const createProvider = useCreateEmailProvider();
  const createOAuth2Provider = useCreateOAuth2Provider();
  const testConnection = useTestEmailConnection();

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      name: 'Outlook',
      email: '',
      password: '',
      isDefault: false,
    },
  });

  const oauth2Form = useForm<OAuth2FormData>({
    resolver: zodResolver(oauth2Schema),
    defaultValues: {
      name: 'Outlook',
      isDefault: false,
      useApiSending: true,
      clientId: '',
      clientSecret: '',
      tenantId: '',
    },
  });

  useEffect(() => {
    if (useSsoCredentialsChecked && hasSsoConfigured) {
      setIsLoadingSsoCredentials(true);
      fetchSsoCredentials({ organizationId })
        .then((credentials) => {
          if (credentials) {
            oauth2Form.setValue('clientId', credentials.clientId);
            oauth2Form.setValue('clientSecret', credentials.clientSecret);
            oauth2Form.setValue('tenantId', credentials.tenantId);
          }
        })
        .catch((error) => {
          console.error('Failed to fetch SSO credentials:', error);
          toast({
            title: t('integrations.failedToLoadSsoCredentials'),
            variant: 'destructive',
          });
          setUseSsoCredentialsChecked(false);
        })
        .finally(() => {
          setIsLoadingSsoCredentials(false);
        });
    }
  }, [useSsoCredentialsChecked, hasSsoConfigured, organizationId, fetchSsoCredentials, oauth2Form, t]);

  useEffect(() => {
    if (!open) {
      setUseSsoCredentialsChecked(false);
      oauth2Form.reset();
      passwordForm.reset();
    }
  }, [open, oauth2Form, passwordForm]);

  const handleOAuth2Submit = async (data: OAuth2FormData) => {
    setIsLoading(true);
    try {
      toast({
        title: t('integrations.settingUpOAuth'),
      });

      await createOAuth2Provider({
        organizationId: organizationId as string,
        name: data.name,
        vendor: 'outlook',
        provider: 'microsoft',
        sendMethod: data.useApiSending ? 'api' : 'smtp',
        smtpConfig: data.useApiSending
          ? undefined
          : {
              host: 'smtp.office365.com',
              port: 587,
              secure: false,
            },
        imapConfig: {
          host: 'outlook.office365.com',
          port: 993,
          secure: true,
        },
        isDefault: data.isDefault,
        accountType: 'both',
        tenantId: data.tenantId || undefined,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        credentialsSource: useSsoCredentialsChecked ? 'sso' : 'manual',
      });

      toast({
        title: t('integrations.providerSaved'),
        description: t('integrations.authorizationRequired'),
        variant: 'success',
      });

      oauth2Form.reset();
      onSuccess();
    } catch (error) {
      console.error('Failed to create OAuth2 provider:', error);
      toast({
        title: t('integrations.failedToCreateProvider', { provider: 'Outlook' }),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (data: PasswordFormData) => {
    setIsLoading(true);
    try {
      toast({
        title: t('integrations.testingConnection'),
        description: t('integrations.validatingCredentials'),
      });

      const testResult = await testConnection({
        vendor: 'outlook',
        authMethod: 'password',
        passwordAuth: {
          user: data.email,
          pass: data.password,
        },
        smtpConfig: {
          host: 'smtp.office365.com',
          port: 587,
          secure: false,
        },
        imapConfig: {
          host: 'outlook.office365.com',
          port: 993,
          secure: true,
        },
      });

      if (!testResult.success) {
        const errors = [];
        if (!testResult.smtp.success) {
          errors.push(`SMTP: ${testResult.smtp.error}`);
        }
        if (!testResult.imap.success) {
          errors.push(`IMAP: ${testResult.imap.error}`);
        }

        toast({
          title: t('integrations.connectionTestFailed'),
          description: errors.join('. '),
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: t('integrations.connectionSuccessful'),
        variant: 'success',
      });

      await createProvider({
        organizationId: organizationId as string,
        name: data.name,
        vendor: 'outlook',
        authMethod: 'password',
        passwordAuth: {
          user: data.email,
          pass: data.password,
        },
        smtpConfig: {
          host: 'smtp.office365.com',
          port: 587,
          secure: false,
        },
        imapConfig: {
          host: 'outlook.office365.com',
          port: 993,
          secure: true,
        },
        isDefault: data.isDefault,
      });

      toast({
        title: t('integrations.providerCreated', { provider: 'Outlook', smtp: testResult.smtp.latencyMs, imap: testResult.imap.latencyMs }),
        variant: 'success',
      });

      passwordForm.reset();
      onSuccess();
    } catch (error) {
      console.error('Failed to create Outlook provider:', error);
      toast({
        title: t('integrations.failedToCreateProvider', { provider: 'Outlook' }),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const customHeader = (
    <HStack gap={3}>
      <div className="size-8 bg-background border border-border rounded-md grid place-items-center">
        <OutlookIcon className="size-5" />
      </div>
      <span className="font-semibold">{t('integrations.addProvider', { provider: 'Outlook' })}</span>
    </HStack>
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.addProvider', { provider: 'Outlook' })}
      customHeader={customHeader}
      customFooter={<></>}
      isSubmitting={isLoading}
      large
    >
      <Tabs
        value={authMethod}
        onValueChange={(value) => setAuthMethod(value as AuthMethod)}
      >
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="oauth2" className="gap-2">
            <Shield className="size-4" />
            {t('integrations.oauth2Tab')}
            <span className="ml-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
              {t('integrations.recommended')}
            </span>
          </TabsTrigger>
          <TabsTrigger value="password" className="gap-2">
            <Key className="size-4" />
            {t('integrations.appPasswordTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="oauth2" className="mt-0">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-3">
            <p className="text-xs text-blue-700 mb-1.5">
              {t('integrations.microsoftOAuthCredentialsInfo')}
            </p>
            <code className="block text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded mb-1.5 break-all">
              {siteUrl}/api/auth/oauth2/callback
            </code>
            <a
              href="https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              {t('integrations.microsoftOAuth2Guide')}
            </a>
          </div>

          {hasSsoConfigured && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 mb-3">
              <HStack gap={2} className="items-start">
                <Checkbox
                  id="use-sso-credentials"
                  checked={useSsoCredentialsChecked}
                  onCheckedChange={(checked) => setUseSsoCredentialsChecked(!!checked)}
                  disabled={isLoadingSsoCredentials}
                />
                <div className="flex-1">
                  <label
                    htmlFor="use-sso-credentials"
                    className="text-xs font-medium text-green-800 cursor-pointer flex items-center gap-1.5"
                  >
                    {t('integrations.useSsoCredentials')}
                    {isLoadingSsoCredentials && <Loader2 className="size-3 animate-spin" />}
                  </label>
                  <p className="text-xs text-green-700 mt-0.5">
                    {t('integrations.useSsoCredentialsDescription')}
                  </p>
                </div>
              </HStack>
            </div>
          )}

          <Stack gap={3}>
            <Input
              id="oauth2-client-id"
              label={t('integrations.microsoftClientId')}
              {...oauth2Form.register('clientId')}
              placeholder={t('integrations.microsoftClientIdPlaceholder')}
              errorMessage={oauth2Form.formState.errors.clientId?.message}
            />

            <Input
              id="oauth2-client-secret"
              type="password"
              label={t('integrations.microsoftClientSecret')}
              {...oauth2Form.register('clientSecret')}
              placeholder={t('integrations.microsoftClientSecretPlaceholder')}
              errorMessage={oauth2Form.formState.errors.clientSecret?.message}
            />

            <Input
              id="oauth2-tenant-id"
              label={t('integrations.microsoftTenantId')}
              {...oauth2Form.register('tenantId')}
              placeholder={t('integrations.microsoftTenantIdPlaceholder')}
            />

            <Input
              id="oauth2-name"
              label={t('integrations.providerName')}
              {...oauth2Form.register('name')}
              placeholder={t('integrations.outlook.namePlaceholder')}
              errorMessage={oauth2Form.formState.errors.name?.message}
            />

            <HStack gap={4}>
              <Checkbox
                id="oauth2-api-sending"
                checked={oauth2Form.watch('useApiSending')}
                onCheckedChange={(checked) =>
                  oauth2Form.setValue('useApiSending', !!checked)
                }
                label={t('integrations.useApiSendingShort')}
              />

              <Checkbox
                id="oauth2-default"
                checked={oauth2Form.watch('isDefault')}
                onCheckedChange={(checked) =>
                  oauth2Form.setValue('isDefault', !!checked)
                }
                label={t('integrations.setAsDefault')}
              />
            </HStack>

            <Button
              type="button"
              fullWidth
              disabled={isLoading}
              onClick={oauth2Form.handleSubmit(handleOAuth2Submit)}
            >
              {isLoading
                ? t('integrations.redirectingToMicrosoft')
                : t('integrations.continueWithMicrosoft')}
            </Button>
          </Stack>
        </TabsContent>

        <TabsContent value="password" className="mt-0">
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-2.5 mb-3">
            <p className="text-xs text-orange-800 mb-1">
              <strong>{t('integrations.outlookLimitedAvailability')}</strong>
            </p>
            <p className="text-xs text-orange-700 mb-1.5">
              {t('integrations.outlookSecurityWarning')}
            </p>
            <a
              href="https://support.microsoft.com/en-us/account-billing/manage-app-passwords-for-two-step-verification-d6dc8c6d-4bf7-4851-ad95-6d07799387e9"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-orange-600 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="size-3" />
              {t('integrations.microsoftAppPasswordsGuide')}
            </a>
          </div>

          <Stack gap={3}>
            <Input
              id="name"
              label={t('integrations.providerName')}
              {...passwordForm.register('name')}
              placeholder={t('integrations.outlook.namePlaceholder')}
              errorMessage={passwordForm.formState.errors.name?.message}
            />

            <Input
              id="email"
              type="email"
              label={t('integrations.emailAddress')}
              {...passwordForm.register('email')}
              placeholder={t('integrations.outlook.emailPlaceholder')}
              errorMessage={passwordForm.formState.errors.email?.message}
            />

            <Input
              id="password"
              type="password"
              label={t('integrations.appPassword')}
              {...passwordForm.register('password')}
              placeholder={t('integrations.outlook.passwordPlaceholder')}
              errorMessage={passwordForm.formState.errors.password?.message}
            />

            <Checkbox
              id="password-default"
              checked={passwordForm.watch('isDefault')}
              onCheckedChange={(checked) =>
                passwordForm.setValue('isDefault', !!checked)
              }
              label={t('integrations.setAsDefault')}
            />

            <Button
              type="button"
              fullWidth
              disabled={isLoading}
              onClick={passwordForm.handleSubmit(handlePasswordSubmit)}
            >
              {isLoading
                ? t('integrations.testingAndCreating')
                : t('integrations.testAndCreate')}
            </Button>
          </Stack>
        </TabsContent>
      </Tabs>
    </FormDialog>
  );
}
