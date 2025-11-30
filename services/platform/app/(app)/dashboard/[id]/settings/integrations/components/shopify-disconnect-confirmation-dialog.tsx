'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DialogProps } from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface ShopifyDisconnectConfirmationDialogProps extends DialogProps {
  domain?: string;
  onConfirm: () => Promise<void> | void;
}

export default function ShopifyDisconnectConfirmationDialog({
  domain,
  onConfirm,
  ...props
}: ShopifyDisconnectConfirmationDialogProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsDisconnecting(true);
      await onConfirm();

      toast({
        title: 'Shopify disconnected successfully.',
        variant: 'success',
      });

      // Dialog will be closed by parent component after successful disconnect
    } catch (error) {
      toast({
        title: 'Disconnection failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to disconnect Shopify. Please try again.',
        variant: 'destructive',
      });

      setIsDisconnecting(false);
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent
        className="p-0"
        onInteractOutside={(e) => isDisconnecting && e.preventDefault()}
        onEscapeKeyDown={(e) => isDisconnecting && e.preventDefault()}
      >
        {/* Header */}
        <div className="border-b border-border flex items-start justify-between px-4 py-6">
          <DialogHeader className="space-y-1">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="size-4 text-destructive" />
              <DialogTitle>Disconnect Shopify?</DialogTitle>
            </div>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-4 py-2 space-y-2">
          <div className="space-y-3">
            {domain && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Connected Store:
                </p>
                <p className="text-sm text-muted-foreground">{domain}</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm text-foreground">
                Are you sure you want to disconnect the Shopify integration?
              </p>

              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                <p className="text-sm text-destructive">
                  <strong>Warning:</strong> Disconnecting Shopify will stop all
                  data synchronization for products, orders, and customers. You
                  will need to reconnect to resume these features.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border flex items-center justify-stretch p-4 gap-4">
          <DialogClose asChild>
            <Button
              variant="outline"
              className="flex-1"
              disabled={isDisconnecting}
            >
              Cancel
            </Button>
          </DialogClose>

          <Button
            onClick={handleConfirm}
            variant="destructive"
            className="flex-1"
            disabled={isDisconnecting}
          >
            {isDisconnecting ? 'Disconnecting...' : 'Yes, Disconnect'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
