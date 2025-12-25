'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormModal } from '@/components/ui/modals';
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
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

// Type for the form data
type CirculyFormValues = {
  username: string;
  password: string;
};

interface CirculyIntegrationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  open,
  onOpenChange,
  credentials,
  onConnect,
  onDisconnect,
}: CirculyIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  // Create Zod schema with translated validation messages
  const circulySchema = useMemo(
    () =>
      z.object({
        username: z
          .string()
          .min(2, tCommon('validation.minLength', { field: t('integrations.circuly.username'), min: 2 }))
          .max(50, tCommon('validation.maxLength', { field: t('integrations.circuly.username'), max: 50 })),
        password: z
          .string()
          .min(2, tCommon('validation.minLength', { field: t('integrations.circuly.password'), min: 2 }))
          .max(50, tCommon('validation.maxLength', { field: t('integrations.circuly.password'), max: 50 })),
      }),
    [t, tCommon],
  );

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
      onOpenChange?.(false);
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
      onOpenChange?.(false);
    } catch {
      toast({
        title: t('integrations.failedToDisconnect', { provider: 'Circuly' }),
        variant: 'destructive',
      });
    }
  };

  const footer = isConnected && onDisconnect ? (
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
      <Button
        variant="outline"
        className="flex-1"
        onClick={() => onOpenChange?.(false)}
      >
        {tCommon('actions.cancel')}
      </Button>
      <Button
        onClick={handleSubmit(handleConnect)}
        className="flex-1"
        disabled={isSubmitting || !username || !password}
      >
        {isSubmitting ? t('integrations.circuly.connecting') : t('integrations.circuly.connect')}
      </Button>
    </>
  );

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.circulyIntegration')}
      customFooter={footer}
      isSubmitting={isSubmitting}
    >
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
    </FormModal>
  );
}
