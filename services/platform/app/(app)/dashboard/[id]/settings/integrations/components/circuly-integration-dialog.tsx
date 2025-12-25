'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Form,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DialogProps } from '@radix-ui/react-dialog';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

// Validation schema for Circuly credentials
const circulySchema = z.object({
  username: z
    .string()
    .min(2, 'Username must be at least 2 characters')
    .max(50, 'Username must be less than 50 characters'),
  password: z
    .string()
    .min(2, 'Password must be at least 2 characters')
    .max(50, 'Password must be less than 50 characters'),
});

type CirculyFormValues = z.infer<typeof circulySchema>;

interface CirculyIntegrationDialogProps extends DialogProps {
  credentials?: {
    username?: string;
  } | null;
  onConnect: (data: {
    username: string;
    password: string;
  }) => Promise<void> | void;
  onDisconnect?: () => Promise<void> | void;
}

export default function CirculyIntegrationDialog({
  credentials,
  onConnect,
  onDisconnect,
  ...props
}: CirculyIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const isConnected = !!credentials?.username;
  const existingUsername = credentials?.username || '';

  // Initialize form with validation
  const form = useForm<CirculyFormValues>({
    resolver: zodResolver(circulySchema),
    defaultValues: {
      username: credentials?.username || '',
      password: '',
    },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
    reset,
    watch,
  } = form;

  // Watch form values to enable/disable button
  const username = watch('username');
  const password = watch('password');

  const handleConnect = async (values: CirculyFormValues) => {
    try {
      await onConnect(values);

      toast({
        title: isConnected ? t('integrations.updateSuccessful') : t('integrations.connectionSuccessful'),
        description: t('integrations.connectedTo', { provider: 'Circuly' }),
        variant: 'success',
      });

      // Only clear form if it's a new connection
      if (!isConnected) {
        reset();
      }
      props.onOpenChange?.(false);
    } catch (error) {
      console.error('Failed to connect to Circuly:', error);
      toast({
        title: isConnected ? t('integrations.updateFailed') : t('integrations.connectionTestFailed'),
        description: t('integrations.failedToDisconnect', { provider: 'Circuly' }),
        variant: 'destructive',
      });
    }
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;

    try {
      await onDisconnect();
      reset();
      props.onOpenChange?.(false);
    } catch {
      toast({
        title: t('integrations.failedToDisconnect', { provider: 'Circuly' }),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent
        className="p-0"
        onInteractOutside={(e) => isSubmitting && e.preventDefault()}
        onEscapeKeyDown={(e) => isSubmitting && e.preventDefault()}
      >
        {/* Header */}
        <div className="border-b border-border flex items-start justify-between px-4 py-6">
          <DialogHeader className="space-y-1">
            <DialogTitle>{t('integrations.circulyIntegration')}</DialogTitle>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-4 space-y-5">
          {isConnected ? (
            // Connected state - show current connection info
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-sm text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>{t('integrations.circuly.connectedToCirculy')}</span>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80">
                  {t('integrations.circuly.connectedUsername')}
                </label>
                <div className="p-3 bg-muted rounded-md text-sm">
                  {existingUsername || t('integrations.circuly.connected')}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {t('integrations.circuly.syncingData')}
              </p>
            </div>
          ) : (
            // Not connected state - show connection form
            <Form {...form}>
              <form
                onSubmit={handleSubmit(handleConnect)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('integrations.circuly.username')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('integrations.circuly.usernamePlaceholder')}
                          {...field}
                          disabled={isSubmitting}
                          className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('integrations.circuly.password')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type="password"
                            placeholder={t('integrations.circuly.passwordPlaceholder')}
                            {...field}
                            disabled={isSubmitting}
                            className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] pr-10"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <p className="text-xs text-muted-foreground">
                  {t('integrations.circuly.enterCredentials')}
                </p>
              </form>
            </Form>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border flex items-center justify-stretch p-4 gap-4">
          {isConnected && onDisconnect ? (
            <>
              <Button
                variant="destructive"
                onClick={handleDisconnect}
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? t('integrations.disconnecting') : t('integrations.disconnect')}
              </Button>
              <Button
                onClick={handleSubmit(handleConnect)}
                disabled={isSubmitting || !username || !password}
                className="flex-1"
              >
                {isSubmitting ? t('integrations.circuly.updating') : t('integrations.circuly.update')}
              </Button>
            </>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="outline" className="flex-1">
                  {tCommon('actions.cancel')}
                </Button>
              </DialogClose>
              <Button
                onClick={handleSubmit(handleConnect)}
                className="flex-1"
                disabled={isSubmitting || !username || !password}
              >
                {isSubmitting ? t('integrations.circuly.connecting') : t('integrations.circuly.connect')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
