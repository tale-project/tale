'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormModal } from '@/components/ui/modals';
import { Form } from '@/components/ui/form';
import { Description } from '@/components/ui/description';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { Stack } from '@/components/ui/layout';
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
        <Form>
          <StatusIndicator variant="success">
            {t('integrations.circuly.connectedToCirculy')}
          </StatusIndicator>

          <Stack gap={2}>
            <span className="text-sm font-medium text-foreground/80">
              {t('integrations.circuly.connectedUsername')}
            </span>
            <div className="p-3 bg-muted rounded-md text-sm">
              {existingUsername || t('integrations.circuly.connected')}
            </div>
          </Stack>

          <Description className="text-xs">
            {t('integrations.circuly.syncingData')}
          </Description>
        </Form>
      ) : (
        // Not connected state - show connection form
        <form onSubmit={handleSubmit(handleConnect)}>
          <Form>
            <Input
              label={t('integrations.circuly.username')}
              placeholder={t('integrations.circuly.usernamePlaceholder')}
              disabled={isSubmitting}
              errorMessage={form.formState.errors.username?.message}
              className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
              {...form.register('username')}
            />

            <Input
              type="password"
              label={t('integrations.circuly.password')}
              placeholder={t('integrations.circuly.passwordPlaceholder')}
              disabled={isSubmitting}
              errorMessage={form.formState.errors.password?.message}
              className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
              {...form.register('password')}
            />

            <Description className="text-xs">
              {t('integrations.circuly.enterCredentials')}
            </Description>
          </Form>
        </form>
      )}
    </FormModal>
  );
}
