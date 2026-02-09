'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

const protelSchema = z.object({
  server: z.string().min(1).max(255),
  port: z.number().min(1).max(65535),
  database: z.string().min(1).max(128),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(128),
});

type ProtelFormValues = z.infer<typeof protelSchema>;

interface ProtelIntegrationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  credentials?: {
    server?: string;
    port?: number;
    database?: string;
    username?: string;
  } | null;
  onConnect: (data: ProtelFormValues) => Promise<void> | void;
  onDisconnect?: () => Promise<void> | void;
}

export function ProtelIntegrationDialog({
  open,
  onOpenChange,
  credentials,
  onConnect,
  onDisconnect,
}: ProtelIntegrationDialogProps) {
  const { t } = useT('settings');
  const isConnected = !!credentials?.server;

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
    reset,
  } = useForm<ProtelFormValues>({
    resolver: zodResolver(protelSchema),
    defaultValues: {
      server: credentials?.server || '',
      port: credentials?.port || 1433,
      database: credentials?.database || 'Protel',
      username: credentials?.username || '',
      password: '',
    },
  });

  const handleConnect = async (values: ProtelFormValues) => {
    try {
      await onConnect(values);
      toast({
        title: isConnected
          ? t('integrations.protel.updateSuccess')
          : t('integrations.protel.connectionSuccess'),
        description: isConnected
          ? t('integrations.protel.updateSuccessDescription')
          : t('integrations.protel.connectionSuccessDescription'),
        variant: 'success',
      });
      if (!isConnected) {
        reset();
      }
      onOpenChange?.(false);
    } catch (error) {
      console.error('Failed to connect to Protel:', error);
      toast({
        title: isConnected
          ? t('integrations.protel.updateFailed')
          : t('integrations.protel.connectionFailed'),
        description: t('integrations.protel.connectionFailedDescription'),
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
      toast({
        title: t('integrations.protel.disconnected'),
        description: t('integrations.protel.disconnectedDescription'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to disconnect Protel:', error);
      toast({
        title: t('integrations.protel.disconnectFailed'),
        description: t('integrations.protel.disconnectFailedDescription'),
        variant: 'destructive',
      });
    }
  };

  const customFooter =
    isConnected && onDisconnect ? (
      <>
        <Button
          variant="destructive"
          onClick={handleDisconnect}
          disabled={isSubmitting}
          className="flex-1"
        >
          {isSubmitting
            ? t('integrations.protel.disconnecting')
            : t('integrations.protel.disconnect')}
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting
            ? t('integrations.protel.updating')
            : t('integrations.protel.update')}
        </Button>
      </>
    ) : undefined;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.protel.title')}
      description={t('integrations.protel.description')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(handleConnect)}
      submitText={t('integrations.protel.connect')}
      submittingText={t('integrations.protel.connecting')}
      customFooter={customFooter}
      className="max-w-lg"
    >
      {isConnected ? (
        <div className="bg-success/10 rounded-md p-4">
          <p className="text-success text-sm font-medium">
            {t('integrations.protel.connectedTo', {
              server: credentials?.server ?? '',
            })}
          </p>
          <p className="text-success/80 mt-1 text-xs">
            {t('integrations.protel.database')}: {credentials?.database}
          </p>
        </div>
      ) : (
        <>
          <HStack gap={3}>
            <Input
              id="server"
              label={t('integrations.protel.serverAddress')}
              placeholder={t('integrations.protel.serverPlaceholder')}
              disabled={isSubmitting}
              errorMessage={errors.server?.message}
              className="flex-[2]"
              {...register('server')}
            />
            <Input
              id="port"
              type="number"
              label={t('integrations.protel.port')}
              placeholder="1433"
              disabled={isSubmitting}
              errorMessage={errors.port?.message}
              className="flex-1"
              {...register('port', { valueAsNumber: true })}
            />
          </HStack>

          <Input
            id="database"
            label={t('integrations.protel.databaseName')}
            placeholder="Protel"
            disabled={isSubmitting}
            errorMessage={errors.database?.message}
            {...register('database')}
          />

          <Input
            id="username"
            label={t('integrations.protel.username')}
            placeholder={t('integrations.protel.usernamePlaceholder')}
            disabled={isSubmitting}
            errorMessage={errors.username?.message}
            {...register('username')}
          />

          <Input
            id="password"
            type="password"
            label={t('integrations.protel.password')}
            placeholder={t('integrations.protel.passwordPlaceholder')}
            disabled={isSubmitting}
            errorMessage={errors.password?.message}
            {...register('password')}
          />
        </>
      )}
    </FormDialog>
  );
}
