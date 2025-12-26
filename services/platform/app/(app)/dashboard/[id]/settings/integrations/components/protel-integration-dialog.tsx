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

// Validation schema for Protel SQL credentials
const protelSchema = z.object({
  server: z
    .string()
    .min(1, 'Server address is required')
    .max(255, 'Server address must be less than 255 characters'),
  port: z.coerce.number().min(1).max(65535),
  database: z
    .string()
    .min(1, 'Database name is required')
    .max(128, 'Database name must be less than 128 characters'),
  username: z
    .string()
    .min(1, 'Username is required')
    .max(128, 'Username must be less than 128 characters'),
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password must be less than 128 characters'),
});

type ProtelFormValues = z.infer<typeof protelSchema>;

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

  const form = useForm<ProtelFormValues>({
    resolver: zodResolver(protelSchema),
    defaultValues: {
      server: credentials?.server || '',
      port: credentials?.port || 1433,
      database: credentials?.database || 'Protel',
      username: credentials?.username || '',
      password: '',
    },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
    reset,
  } = form;

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
            <Form {...form}>
              <form
                onSubmit={handleSubmit(handleConnect)}
                className="space-y-4"
              >
                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    control={form.control}
                    name="server"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Server Address</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="192.168.1.100 or hostname"
                            {...field}
                            disabled={isSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="port"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Port</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="1433"
                            {...field}
                            disabled={isSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="database"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Database Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Protel"
                          {...field}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="SQL Server username"
                          {...field}
                          disabled={isSubmitting}
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
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="SQL Server password"
                          {...field}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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

