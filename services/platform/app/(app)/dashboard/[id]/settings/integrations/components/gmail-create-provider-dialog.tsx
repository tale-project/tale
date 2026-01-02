'use client';

import { useState, useMemo } from 'react';
import { ViewDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Form } from '@/components/ui/form';
import { Stack, HStack } from '@/components/ui/layout';
import { GmailIcon } from '@/components/icons';
import { ExternalLink, Shield, Key } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useT } from '@/lib/i18n';
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
  clientId: string;
  clientSecret: string;
};

type AuthMethod = 'oauth2' | 'password';

interface GmailCreateProviderDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess: () => void;
}

export function GmailCreateProviderDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
}: GmailCreateProviderDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

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
        clientId: z.string().min(1, tCommon('validation.required', { field: t('integrations.googleClientId') })),
        clientSecret: z.string().min(1, tCommon('validation.required', { field: t('integrations.googleClientSecret') })),
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
      clientId: '',
      clientSecret: '',
    },
  });

  const handleOAuth2Submit = async (data: OAuth2FormData) => {
    setIsLoading(true);
    try {
      // Step 1: Create provider with OAuth2 config (credentials from server env vars)
      toast({
        title: t('integrations.creatingProvider'),
        description: t('integrations.settingUpOAuth'),
      });

      const providerId = await createOAuth2Provider({
        organizationId: organizationId as string,
        name: data.name,
        vendor: 'gmail',
        provider: 'gmail',
        sendMethod: data.useApiSending ? 'api' : 'smtp',
        smtpConfig: data.useApiSending
          ? undefined
          : {
              host: 'smtp.gmail.com',
              port: 587,
              secure: false,
            },
        imapConfig: {
          host: 'imap.gmail.com',
          port: 993,
          secure: true,
        },
        isDefault: data.isDefault,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      });

      // Step 2: Generate OAuth2 authorization URL
      // Pass the current origin to preserve the hostname (localhost vs 127.0.0.1)
      const redirectUri = `${window.location.origin}/api/auth/oauth2/callback`;
      console.log(
        '[OAuth2 Client] window.location.origin:',
        window.location.origin,
      );
      console.log('[OAuth2 Client] redirectUri:', redirectUri);

      const authUrl = await generateAuthUrl({
        emailProviderId: providerId,
        organizationId: organizationId as string,
        redirectUri,
      });

      console.log('[OAuth2 Client] Generated authUrl:', authUrl);

      toast({
        title: t('integrations.redirectingToGoogle'),
        description: t('integrations.authorizeGmail'),
      });

      // Step 3: Redirect to Google for authorization
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
        vendor: 'gmail',
        authMethod: 'password',
        passwordAuth: {
          user: data.email,
          pass: data.password,
        },
        smtpConfig: {
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
        },
        imapConfig: {
          host: 'imap.gmail.com',
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
      });

      await createProvider({
        organizationId: organizationId as string,
        name: data.name,
        vendor: 'gmail',
        authMethod: 'password',
        passwordAuth: {
          user: data.email,
          pass: data.password,
        },
        smtpConfig: {
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
        },
        imapConfig: {
          host: 'imap.gmail.com',
          port: 993,
          secure: true,
        },
        isDefault: data.isDefault,
      });

      toast({
        title: t('integrations.providerCreated', { provider: 'Gmail', smtp: testResult.smtp.latencyMs, imap: testResult.imap.latencyMs }),
        variant: 'success',
      });

      passwordForm.reset();
      onSuccess();
    } catch (error) {
      console.error('Failed to create Gmail provider:', error);
      toast({
        title: t('integrations.failedToCreateProvider', { provider: 'Gmail' }),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const customHeader = (
    <HStack gap={3}>
      <div className="size-8 bg-background border border-border rounded-md grid place-items-center">
        <GmailIcon className="size-5" />
      </div>
      <span className="font-semibold">{t('integrations.addProvider', { provider: 'Gmail' })}</span>
    </HStack>
  );

  return (
    <ViewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.addProvider', { provider: 'Gmail' })}
      customFooter={<></>}
    >
      <Tabs
        value={authMethod}
        onValueChange={(value) => setAuthMethod(value as AuthMethod)}
      >
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="oauth2" className="gap-2">
            <Shield className="size-4" />
            {t('integrations.oauth2Tab')}
          </TabsTrigger>
          <TabsTrigger value="password" className="gap-2">
            <Key className="size-4" />
            {t('integrations.appPasswordTab')}
          </TabsTrigger>
        </TabsList>

        {/* OAuth2 Form */}
        <TabsContent value="oauth2" className="mt-0">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <p className="text-xs text-blue-700 mb-2">
              {t('integrations.googleOAuthCredentialsInfo')}
            </p>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              {t('integrations.googleOAuth2Guide')}
            </a>
          </div>

          <Form onSubmit={oauth2Form.handleSubmit(handleOAuth2Submit)} >
            <Input
              id="oauth2-client-id"
              label={t('integrations.googleClientId')}
              {...oauth2Form.register('clientId')}
              placeholder={t('integrations.googleClientIdPlaceholder')}
              errorMessage={oauth2Form.formState.errors.clientId?.message}
            />

            <Input
              id="oauth2-client-secret"
              type="password"
              label={t('integrations.googleClientSecret')}
              {...oauth2Form.register('clientSecret')}
              placeholder={t('integrations.googleClientSecretPlaceholder')}
              errorMessage={oauth2Form.formState.errors.clientSecret?.message}
            />

            <Input
              id="oauth2-name"
              label={t('integrations.providerName')}
              {...oauth2Form.register('name')}
              placeholder={t('integrations.gmail.namePlaceholder')}
              errorMessage={oauth2Form.formState.errors.name?.message}
            />

            <Checkbox
              id="oauth2-default"
              checked={oauth2Form.watch('isDefault')}
              onCheckedChange={(checked) =>
                oauth2Form.setValue('isDefault', !!checked)
              }
              label={t('integrations.setAsDefaultProvider')}
            />

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading
                ? t('integrations.redirectingToGoogle')
                : t('integrations.continueWithGoogle')}
            </Button>
          </Form>
        </TabsContent>

        {/* Password Form */}
        <TabsContent value="password" className="mt-0">
          <div className="border border-border rounded-lg p-3 mb-4">
            <p className="text-xs">
              {t('integrations.gmailAppPasswordInfo')}
            </p>
            <a
              href="https://support.google.com/accounts/answer/185833"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-1"
            >
              <ExternalLink className="w-3 h-3" />
              {t('integrations.googleAppPasswordsGuide')}
            </a>
          </div>

          <Form onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)} >
            <Input
              id="name"
              label={t('integrations.providerName')}
              {...passwordForm.register('name')}
              placeholder={t('integrations.gmail.namePlaceholder')}
              errorMessage={passwordForm.formState.errors.name?.message}
            />

            <Input
              id="email"
              type="email"
              label={t('integrations.gmailAddress')}
              {...passwordForm.register('email')}
              placeholder={t('integrations.gmail.emailPlaceholder')}
              errorMessage={passwordForm.formState.errors.email?.message}
            />

            <Input
              id="password"
              type="password"
              label={t('integrations.appPassword')}
              {...passwordForm.register('password')}
              placeholder={t('integrations.gmail.passwordPlaceholder')}
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

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading
                ? t('integrations.testingAndCreating')
                : t('integrations.testAndCreate')}
            </Button>
          </Form>
        </TabsContent>
      </Tabs>
    </ViewDialog>
  );
}
