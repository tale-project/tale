'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DialogProps } from '@radix-ui/react-dialog';
import { useState } from 'react';
import { toast } from '@/hooks/use-toast';

interface ProtelDisconnectConfirmationDialogProps extends DialogProps {
  server: string;
  database: string;
  onConfirm: () => Promise<void> | void;
}

export default function ProtelDisconnectConfirmationDialog({
  server,
  database,
  onConfirm,
  ...props
}: ProtelDisconnectConfirmationDialogProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConfirm = async () => {
    setIsDisconnecting(true);
    try {
      await onConfirm();
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
        description: 'Failed to disconnect Protel PMS. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect Protel PMS?</DialogTitle>
          <DialogDescription>
            This will disconnect your Protel PMS integration for{' '}
            <strong>{server}</strong> (database: <strong>{database}</strong>).
            Your hotel data will no longer sync with this platform.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => props.onOpenChange?.(false)}
            disabled={isDisconnecting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isDisconnecting}
          >
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

