'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { HStack } from '@/components/ui/layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

type ProtelFormValues = {
  server: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

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

export default function ProtelIntegrationDialog({
  open,
  onOpenChange,
  credentials,
  onConnect,
  onDisconnect,
}: ProtelIntegrationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const isConnected = !!credentials?.server;

  const protelSchema = useMemo(
    () =>
      z.object({
        server: z.string().min(1).max(255),
        port: z.coerce.number().min(1).max(65535),
        database: z.string().min(1).max(128),
        username: z.string().min(1).max(128),
        password: z.string().min(1).max(128),
      }),
    [],
  );

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

  const customFooter = isConnected && onDisconnect ? (
    <>
      <Button
        variant="destructive"
        onClick={handleDisconnect}
        disabled={isSubmitting}
        className="flex-1"
      >
        {isSubmitting ? t('integrations.protel.disconnecting') : t('integrations.protel.disconnect')}
      </Button>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="flex-1"
      >
        {isSubmitting ? t('integrations.protel.updating') : t('integrations.protel.update')}
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
        <div className="rounded-md bg-success/10 p-4">
          <p className="text-sm font-medium text-success">
            {t('integrations.protel.connectedTo', { server: credentials?.server ?? '' })}
          </p>
          <p className="text-xs text-success/80 mt-1">
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
              {...register('port')}
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
