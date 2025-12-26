'use client';

import { useMemo } from 'react';
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
import { Form } from '@/components/ui/form';
import { HStack } from '@/components/ui/layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DialogProps } from '@radix-ui/react-dialog';
import { toast } from '@/hooks/use-toast';

type ProtelFormValues = {
  server: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

interface ProtelIntegrationDialogProps extends DialogProps {
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
  credentials,
  onConnect,
  onDisconnect,
  ...props
}: ProtelIntegrationDialogProps) {
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
        title: isConnected ? 'Update successful' : 'Connection successful',
        description: isConnected
          ? 'Protel PMS integration has been updated successfully.'
          : 'Protel PMS integration has been connected successfully.',
        variant: 'success',
      });
      if (!isConnected) {
        reset();
      }
      props.onOpenChange?.(false);
    } catch (error) {
      console.error('Failed to connect to Protel:', error);
      toast({
        title: isConnected ? 'Update failed' : 'Connection failed',
        description:
          'Failed to connect to Protel PMS. Please check your credentials.',
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
      toast({
        title: 'Disconnected',
        description: 'Protel PMS integration has been disconnected.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to disconnect Protel:', error);
      toast({
        title: 'Disconnect failed',
        description: 'Failed to disconnect Protel PMS, please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent className="p-0 max-w-lg">
        <div className="border-b border-border px-4 py-6">
          <DialogHeader className="space-y-1">
            <DialogTitle>Protel PMS Integration</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Connect to your Protel hotel management system via SQL Server.
            </p>
          </DialogHeader>
        </div>

        <div className="p-4">
          {isConnected ? (
            <div className="space-y-4">
              <div className="rounded-md bg-success/10 p-4">
                <p className="text-sm font-medium text-success">
                  Connected to {credentials?.server}
                </p>
                <p className="text-xs text-success/80 mt-1">
                  Database: {credentials?.database}
                </p>
              </div>
            </div>
          ) : (
            <Form onSubmit={handleSubmit(handleConnect)}>
              <HStack gap={3}>
                <Input
                  id="server"
                  label="Server Address"
                  placeholder="192.168.1.100 or hostname"
                  disabled={isSubmitting}
                  errorMessage={errors.server?.message}
                  className="flex-[2]"
                  {...register('server')}
                />
                <Input
                  id="port"
                  type="number"
                  label="Port"
                  placeholder="1433"
                  disabled={isSubmitting}
                  errorMessage={errors.port?.message}
                  className="flex-1"
                  {...register('port')}
                />
              </HStack>

              <Input
                id="database"
                label="Database Name"
                placeholder="Protel"
                disabled={isSubmitting}
                errorMessage={errors.database?.message}
                {...register('database')}
              />

              <Input
                id="username"
                label="Username"
                placeholder="SQL Server username"
                disabled={isSubmitting}
                errorMessage={errors.username?.message}
                {...register('username')}
              />

              <Input
                id="password"
                type="password"
                label="Password"
                placeholder="SQL Server password"
                disabled={isSubmitting}
                errorMessage={errors.password?.message}
                {...register('password')}
              />
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
                {isSubmitting ? 'Disconnecting...' : 'Disconnect'}
              </Button>
              <Button
                onClick={handleSubmit(handleConnect)}
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? 'Updating...' : 'Update'}
              </Button>
            </>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="outline" className="flex-1">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                onClick={handleSubmit(handleConnect)}
                className="flex-1"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Connecting...' : 'Connect'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
