'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DialogProps } from '@radix-ui/react-dialog';

interface ShopifyIntegrationDialogProps extends DialogProps {
  credentials?: {
    domain?: string;
    accessToken?: string;
  } | null;
  onConnect: (data: {
    domain: string;
    accessToken: string;
  }) => Promise<void> | void;
  onDisconnect?: () => Promise<void> | void;
}

export default function ShopifyIntegrationDialog({
  credentials,
  onConnect,
  onDisconnect,
  ...props
}: ShopifyIntegrationDialogProps) {
  const [domain, setDomain] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isConnected = !!credentials?.domain;

  // Initialize form with existing credentials
  useEffect(() => {
    if (credentials?.domain) {
      setDomain(credentials.domain);
    }
  }, [credentials]);

  const handleConnect = async () => {
    setIsSubmitting(true);
    try {
      await onConnect({ domain, accessToken });
      // Don't clear on success if updating
      if (!isConnected) {
        setDomain('');
        setAccessToken('');
      }
      // Close dialog
      props.onOpenChange?.(false);

      toast({
        title: isConnected ? 'Update successful' : 'Connection successful',
        description: isConnected
          ? 'Shopify integration has been updated successfully.'
          : 'Shopify integration has been connected successfully.',
        variant: 'success',
      });
    } catch {
      // Keep dialog open and surface error without leaking credentials
      toast({
        title: isConnected ? 'Update failed' : 'Connection failed',
        description:
          'Failed to connect to Shopify. Please check your credentials.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;

    setIsSubmitting(true);
    try {
      await onDisconnect();
      setDomain('');
      setAccessToken('');
      props.onOpenChange?.(false);
    } catch {
      toast({
        title: 'Disconnect failed',
        description: 'Failed to disconnect Shopify, please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent className="p-0">
        {/* Header */}
        <div className="border-b border-border flex items-start justify-between px-4 py-6">
          <DialogHeader className="space-y-1">
            <DialogTitle>Shopify integration</DialogTitle>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-4 space-y-5">
          {isConnected && (
            <div className="flex items-center space-x-2 text-sm text-green-600">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Connected to Shopify</span>
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-2">
              <Label
                htmlFor="shopify-domain"
                className="text-sm font-medium text-foreground/80"
              >
                Domain
              </Label>
              <Input
                id="shopify-domain"
                placeholder="mystore.myshopify.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                disabled={isSubmitting}
                className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
              />
            </div>
            <p className="text-xs text-muted-foreground leading-[20px]">
              Your shop&apos;s .myshopify.com address (e.g.,
              mystore.myshopify.com).
              <br />
              Go to Shopify → Settings → Domains.
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label
                htmlFor="shopify-access-token"
                className="text-sm font-medium text-foreground/80"
              >
                Access token
              </Label>
              <Input
                id="shopify-access-token"
                type="password"
                placeholder={
                  isConnected
                    ? '••••••••••••••••'
                    : 'shpat_1234567890abcdef1234567890abcdef'
                }
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                disabled={isSubmitting}
                className="border-gray-300 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
              />
            </div>
            <p className="text-xs text-muted-foreground leading-[20px]">
              Your Shopify Admin API access token from your custom app.
              <br />
              Go to Shopify → Apps → Develop apps → [Your app] → API credentials
              → Admin API access token (Reveal).
            </p>
          </div>
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
                onClick={handleConnect}
                disabled={isSubmitting || !domain || !accessToken}
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
                onClick={handleConnect}
                className="flex-1"
                disabled={isSubmitting || !domain || !accessToken}
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
