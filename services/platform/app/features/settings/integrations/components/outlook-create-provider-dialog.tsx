'use client';

import { useState, useMemo } from 'react';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { Input } from '@/app/components/ui/forms/input';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/navigation/tabs';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { OutlookIcon } from '@/app/components/icons/outlook-icon';
import { ExternalLink, Shield, Key } from 'lucide-react';
import { toast } from '@/app/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';
import { useCreateEmailProvider } from '../hooks/use-create-email-provider';
import { useCreateOAuth2Provider } from '../hooks/use-create-oauth2-provider';
import { useTestEmailConnection } from '../hooks/use-test-email-connection';
import { useGenerateOAuthUrl } from '../hooks/use-generate-oauth-url';

// Type for the form data
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
};

type AuthMethod = 'oauth2' | 'password';

interface OutlookCreateProviderDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess: () => void;
}

export function OutlookCreateProviderDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
}: OutlookCreateProviderDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const siteUrl = useSiteUrl();

  // Create Zod schemas with translated validation messages
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
      }),
    [t, tCommon],
  );

  const [authMethod, setAuthMethod] = useState<AuthMethod>('oauth2');
  const [isLoading, setIsLoading] = useState(false);

  // Convex actions (hooks)
  const createProvider = useCreateEmailProvider();
  const createOAuth2Provider = useCreateOAuth2Provider();
  const testConnection = useTestEmailConnection();
  const generateAuthUrl = useGenerateOAuthUrl();

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      isDefault: false,
    },
  });

  const oauth2Form = useForm<OAuth2FormData>({
    resolver: zodResolver(oauth2Schema),
    defaultValues: {
      name: '',
      isDefault: false,
      useApiSending: true, // Default to API sending for OAuth2
    },
  });

  const handleOAuth2Submit = async (data: OAuth2FormData) => {
    setIsLoading(true);
    try {
      // Step 1: Create provider with OAuth2 config (credentials from server env vars)
      toast({
        title: t('integrations.settingUpOAuth'),
      });

      const providerId = await createOAuth2Provider({
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
        accountType: 'organizational',
      });

      // Step 2: Generate OAuth2 authorization URL
      const redirectUri = `${siteUrl}/api/auth/oauth2/callback`;

      const authUrl = await generateAuthUrl({
        emailProviderId: providerId,
        organizationId: organizationId as string,
        redirectUri,
      });

      console.log('[OAuth2 Client] Generated authUrl:', authUrl);

      toast({
        title: t('integrations.redirectingToMicrosoft'),
        description: t('integrations.authorizeOutlook'),
      });

      // Step 3: Redirect to Microsoft for authorization
      window.location.href = authUrl;
    } catch (error) {
      console.error('Failed to initiate OAuth2 flow:', error);
      toast({
        title: t('integrations.failedToStartAuth'),
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (data: PasswordFormData) => {
    setIsLoading(true);
    try {
      // Step 1: Test connection BEFORE saving
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

      // If test failed, show error and don't save
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

      // Step 2: Connection successful, now save
      toast({
        title: t('integrations.connectionSuccessful'),
        variant: 'success',
        description: t('integrations.providerCreated', { provider: 'Outlook', smtp: testResult.smtp.latencyMs, imap: testResult.imap.latencyMs }),
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
    >
      <Tabs
            value={authMethod}
            onValueChange={(value) => setAuthMethod(value as AuthMethod)}
          >
            <TabsList className="grid w-full grid-cols-2 mb-6">
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

            {/* OAuth2 Form */}
            <TabsContent value="oauth2" className="mt-0">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-blue-800 mb-2">
                  <strong>{t('integrations.oauth2Authentication')}</strong>
                </p>
                <p className="text-sm text-blue-700 mb-2">
                  {t('integrations.oauth2MicrosoftInfo')}
                </p>
                <a
                  href="https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('integrations.microsoftOAuth2Guide')}
                </a>
              </div>

              <Stack gap={4}>
                <Input
                  id="oauth2-name"
                  label={t('integrations.providerName')}
                  {...oauth2Form.register('name')}
                  placeholder={t('integrations.outlook.namePlaceholder')}
                  errorMessage={oauth2Form.formState.errors.name?.message}
                />

                <Stack gap={3}>
                  <Checkbox
                    id="oauth2-api-sending"
                    checked={oauth2Form.watch('useApiSending')}
                    onCheckedChange={(checked) =>
                      oauth2Form.setValue('useApiSending', !!checked)
                    }
                    label={t('integrations.useApiSending')}
                  />

                  <Checkbox
                    id="oauth2-default"
                    checked={oauth2Form.watch('isDefault')}
                    onCheckedChange={(checked) =>
                      oauth2Form.setValue('isDefault', !!checked)
                    }
                    label={t('integrations.setAsDefaultProvider')}
                  />
                </Stack>

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

            {/* Password Form */}
            <TabsContent value="password" className="mt-0">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-orange-800 mb-2">
                  <strong>{t('integrations.outlookLimitedAvailability')}</strong>
                </p>
                <p className="text-sm text-orange-700 mb-2">
                  {t('integrations.outlookSecurityWarning')}
                </p>
                <a
                  href="https://support.microsoft.com/en-us/account-billing/manage-app-passwords-for-two-step-verification-d6dc8c6d-4bf7-4851-ad95-6d07799387e9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-orange-600 hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="size-3" />
                  {t('integrations.microsoftAppPasswordsGuide')}
                </a>
              </div>

              <Stack gap={4}>
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
                  label={t('integrations.setAsDefaultProvider')}
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
