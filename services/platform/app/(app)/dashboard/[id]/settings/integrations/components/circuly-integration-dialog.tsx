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
        title: isConnected ? 'Update successful' : 'Connection successful',
        description: isConnected
          ? 'Circuly integration has been updated successfully.'
          : 'Circuly integration has been connected successfully.',
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
        title: isConnected ? 'Update failed' : 'Connection failed',
        description:
          'Failed to connect to Circuly. Please check your credentials.',
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
        title: 'Failed to disconnect Circuly',
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
            <DialogTitle>Circuly integration</DialogTitle>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-4 space-y-5">
          {isConnected ? (
            // Connected state - show current connection info
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-sm text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>Connected to Circuly</span>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80">
                  Connected Username
                </label>
                <div className="p-3 bg-muted rounded-md text-sm">
                  {existingUsername || 'Connected'}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Your Circuly account is connected and syncing subscription data.
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
                      <FormLabel>Circuly Username</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter your Circuly username"
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
                      <FormLabel>Circuly Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type="password"
                            placeholder="Enter your Circuly password"
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
                  Enter your Circuly credentials to sync subscription and
                  customer data.
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
                {isSubmitting ? 'Disconnecting...' : 'Disconnect'}
              </Button>
              <Button
                onClick={handleSubmit(handleConnect)}
                disabled={isSubmitting || !username || !password}
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
                disabled={isSubmitting || !username || !password}
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
