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
import { GmailIcon } from '@/components/ui/icons';
import { DialogProps } from '@radix-ui/react-dialog';
import { ExternalLink, Shield, Key } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

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

interface GmailCreateProviderDialogProps extends DialogProps {
  organizationId: string;
  onSuccess: () => void;
}

export default function GmailCreateProviderDialog({
  organizationId,
  onSuccess,
  ...props
}: GmailCreateProviderDialogProps) {
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
        title: 'Creating provider',
        description: 'Setting up OAuth2 configuration...',
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
        title: 'Redirecting to Google',
        description: 'Please authorize access to your Gmail account...',
      });

      // Step 3: Redirect to Google for authorization
      window.location.href = authUrl;
    } catch (error) {
      console.error('Failed to initiate OAuth2 flow:', error);
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to start OAuth2 authorization',
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
        title: 'Testing connection',
        description: 'Validating SMTP and IMAP credentials...',
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
          title: 'Connection test failed',
          description: errors.join('. '),
          variant: 'destructive',
        });
        return;
      }

      // Step 2: Connection successful, now save
      toast({
        title: 'Connection successful',
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
        title: `Gmail provider created successfully (SMTP: ${testResult.smtp.latencyMs}ms, IMAP: ${testResult.imap.latencyMs}ms)`,
        variant: 'success',
      });

      passwordForm.reset();
      onSuccess();
    } catch (error) {
      console.error('Failed to create Gmail provider:', error);
      toast({
        title: 'Failed to create Gmail provider',
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
                <GmailIcon className="size-5" />
              </div>
              <DialogTitle>Add Gmail provider</DialogTitle>
            </div>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="p-4 pt-2">
          <Tabs
            value={authMethod}
            onValueChange={(value) => setAuthMethod(value as AuthMethod)}
          >
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="oauth2" className="gap-2">
                <Shield className="size-4" />
                OAuth2
              </TabsTrigger>
              <TabsTrigger value="password" className="gap-2">
                <Key className="size-4" />
                App Password
              </TabsTrigger>
            </TabsList>

            {/* OAuth2 Form */}
            <TabsContent value="oauth2" className="mt-0">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-blue-700 mb-2">
                  You'll be redirected to Google to authorize access. This
                  method works with Google security defaults and is more secure
                  than password authentication.
                </p>
                <a
                  href="https://support.google.com/cloud/answer/6158849"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Google OAuth2 Setup Guide
                </a>
              </div>

              <form
                onSubmit={oauth2Form.handleSubmit(handleOAuth2Submit)}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <Label htmlFor="oauth2-name">Provider name</Label>
                  <Input
                    id="oauth2-name"
                    {...oauth2Form.register('name')}
                    placeholder="e.g., Gmail Work Account"
                  />
                  {oauth2Form.formState.errors.name && (
                    <p className="text-sm text-red-600 mt-1">
                      {oauth2Form.formState.errors.name.message}
                    </p>
                  )}
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
                    Set as default email provider
                  </Label>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading
                    ? 'Redirecting to Google...'
                    : 'Continue with Google'}
                </Button>
              </form>
            </TabsContent>

            {/* Password Form */}
            <TabsContent value="password" className="mt-0">
              <div className="border border-border rounded-lg p-3 mb-4">
                <p className="text-xs">
                  Use Gmail App Passwords for quick setup. Requires 2FA enabled
                  on your Google account.
                </p>
                <a
                  href="https://support.google.com/accounts/answer/185833"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Google App Passwords Guide
                </a>
              </div>

              <form
                onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <Label htmlFor="name">Provider Name</Label>
                  <Input
                    id="name"
                    {...passwordForm.register('name')}
                    placeholder="e.g., Gmail organization Account"
                  />
                  {passwordForm.formState.errors.name && (
                    <p className="text-sm text-red-600 mt-1">
                      {passwordForm.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="email">Gmail Address</Label>
                  <Input
                    id="email"
                    type="email"
                    {...passwordForm.register('email')}
                    placeholder="your-email@gmail.com"
                  />
                  {passwordForm.formState.errors.email && (
                    <p className="text-sm text-red-600 mt-1">
                      {passwordForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="password">App Password</Label>
                  <Input
                    id="password"
                    type="password"
                    {...passwordForm.register('password')}
                    placeholder="16-character app password"
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
                    Set as default email provider
                  </Label>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading
                    ? 'Testing & Creating...'
                    : 'Test & create provider'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
