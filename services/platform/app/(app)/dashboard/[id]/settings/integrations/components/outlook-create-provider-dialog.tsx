'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OutlookIcon } from '@/components/ui/icons';
import { DialogProps } from '@radix-ui/react-dialog';
import { ExternalLink, Shield, Key } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n';

const passwordSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'App password is required'),
  isDefault: z.boolean(),
});

const oauth2Schema = z.object({
  name: z.string().min(1, 'Name is required'),
  isDefault: z.boolean(),
  useApiSending: z.boolean(),
});

type PasswordFormData = z.infer<typeof passwordSchema>;
type OAuth2FormData = z.infer<typeof oauth2Schema>;

type AuthMethod = 'oauth2' | 'password';

interface OutlookCreateProviderDialogProps extends DialogProps {
  organizationId: string;
  onSuccess: () => void;
}

export default function OutlookCreateProviderDialog({
  organizationId,
  onSuccess,
  ...props
}: OutlookCreateProviderDialogProps) {
  const { t } = useT('settings');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('oauth2');
  const [isLoading, setIsLoading] = useState(false);

  // Convex actions
  const createProvider = useAction(api.email_providers.create);
  const createOAuth2Provider = useAction(
    api.email_providers.createOAuth2Provider,
  );
  const testConnection = useAction(api.email_providers.testConnection);
  const generateAuthUrl = useAction(api.email_providers.generateOAuth2AuthUrl);

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

  return (
    <Dialog {...props}>
      <DialogContent className="p-0">
        {/* Header */}
        <div className="border-b border-border flex items-start justify-between px-4 py-6">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="size-8 bg-background border border-border rounded-md flex items-center justify-center">
                <OutlookIcon className="size-5" />
              </div>
              <DialogTitle>{t('integrations.addProvider', { provider: 'Outlook' })}</DialogTitle>
            </div>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="p-6 pt-4">
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
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('integrations.microsoftOAuth2Guide')}
                </a>
              </div>

              <form
                onSubmit={oauth2Form.handleSubmit(handleOAuth2Submit)}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <Label htmlFor="oauth2-name">{t('integrations.providerName')}</Label>
                  <Input
                    id="oauth2-name"
                    {...oauth2Form.register('name')}
                    placeholder={t('integrations.outlook.namePlaceholder')}
                  />
                  {oauth2Form.formState.errors.name && (
                    <p className="text-sm text-red-600 mt-1">
                      {oauth2Form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="oauth2-api-sending"
                      checked={oauth2Form.watch('useApiSending')}
                      onCheckedChange={(checked) =>
                        oauth2Form.setValue('useApiSending', !!checked)
                      }
                    />
                    <Label
                      htmlFor="oauth2-api-sending"
                      className="text-sm font-normal cursor-pointer"
                    >
                      {t('integrations.useApiSending')}
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="oauth2-default"
                      checked={oauth2Form.watch('isDefault')}
                      onCheckedChange={(checked) =>
                        oauth2Form.setValue('isDefault', !!checked)
                      }
                    />
                    <Label
                      htmlFor="oauth2-default"
                      className="text-sm font-normal cursor-pointer"
                    >
                      {t('integrations.setAsDefaultProvider')}
                    </Label>
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading
                    ? t('integrations.redirectingToMicrosoft')
                    : t('integrations.continueWithMicrosoft')}
                </Button>
              </form>
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
                  className="text-sm text-orange-600 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="size-3" />
                  {t('integrations.microsoftAppPasswordsGuide')}
                </a>
              </div>

              <form
                onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <Label htmlFor="name">{t('integrations.providerName')}</Label>
                  <Input
                    id="name"
                    {...passwordForm.register('name')}
                    placeholder={t('integrations.outlook.namePlaceholder')}
                  />
                  {passwordForm.formState.errors.name && (
                    <p className="text-sm text-red-600 mt-1">
                      {passwordForm.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="email">{t('integrations.emailAddress')}</Label>
                  <Input
                    id="email"
                    type="email"
                    {...passwordForm.register('email')}
                    placeholder={t('integrations.outlook.emailPlaceholder')}
                  />
                  {passwordForm.formState.errors.email && (
                    <p className="text-sm text-red-600 mt-1">
                      {passwordForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="password">{t('integrations.appPassword')}</Label>
                  <Input
                    id="password"
                    type="password"
                    {...passwordForm.register('password')}
                    placeholder={t('integrations.outlook.passwordPlaceholder')}
                  />
                  {passwordForm.formState.errors.password && (
                    <p className="text-sm text-red-600 mt-1">
                      {passwordForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="password-default"
                    checked={passwordForm.watch('isDefault')}
                    onCheckedChange={(checked) =>
                      passwordForm.setValue('isDefault', !!checked)
                    }
                  />
                  <Label
                    htmlFor="password-default"
                    className="text-sm font-normal cursor-pointer"
                  >
                    {t('integrations.setAsDefaultProvider')}
                  </Label>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading
                    ? t('integrations.testingAndCreating')
                    : t('integrations.testAndCreate')}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
