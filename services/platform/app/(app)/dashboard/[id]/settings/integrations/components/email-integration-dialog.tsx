'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GmailIcon, OutlookIcon } from '@/components/ui/icons';
import { DialogProps } from '@radix-ui/react-dialog';
import { Plus, Trash2, MoreVertical, TestTube, Star, Mail } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import EmailProviderTypeSelector from './email-provider-type-selector';
import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';

interface EmailIntegrationDialogProps extends DialogProps {
  organizationId: string;
}

export default function EmailIntegrationDialog({
  organizationId,
  ...props
}: EmailIntegrationDialogProps) {
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );

  // Fetch all email providers using Convex
  const providers = useQuery(
    api.email_providers.list,
    organizationId ? { organizationId: organizationId as string } : 'skip',
  );

  const isLoading = providers === undefined;

  const deleteProvider = useMutation(api.email_providers.deleteProvider);
  const setDefaultProvider = useMutation(api.email_providers.setDefault);
  const testExistingProvider = useAction(
    api.email_providers.testExistingProvider,
  );

  const handleAddProvider = () => {
    setShowTypeSelector(true);
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProviderId(providerId);
    try {
      toast({
        title: 'Testing connection',
        description: 'Validating SMTP and IMAP credentials...',
      });

      const result = await testExistingProvider({
        providerId: providerId as Id<'emailProviders'>,
      });

      if (result.success) {
        toast({
          title: 'Connection successful',
          variant: 'success',
          description: `All tests passed! SMTP: ${result.smtp.latencyMs}ms, IMAP: ${result.imap.latencyMs}ms`,
        });
      } else {
        const errors = [];
        if (!result.smtp.success) {
          errors.push(`SMTP: ${result.smtp.error}`);
        }
        if (!result.imap.success) {
          errors.push(`IMAP: ${result.imap.error}`);
        }
        toast({
          title: 'Connection test failed',
          description: errors.join('. '),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to test connection:', error);
      toast({
        title: 'Failed to test connection',
        variant: 'destructive',
      });
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await deleteProvider({
        providerId: providerId as Id<'emailProviders'>,
      });
    } catch (error) {
      console.error('Failed to delete provider:', error);
      toast({
        title: 'Failed to delete provider',
        variant: 'destructive',
      });
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultProvider({
        providerId: providerId as Id<'emailProviders'>,
      });
      toast({
        title: 'Default provider updated',
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to set default provider:', error);
      toast({
        title: 'Failed to set default provider',
        variant: 'destructive',
      });
    }
  };

  const getVendorIcon = (vendor: string) => {
    switch (vendor) {
      case 'gmail':
        return <GmailIcon className="size-5" />;
      case 'outlook':
        return <OutlookIcon className="size-5" />;
      default:
        return <Mail className="size-5" />;
    }
  };

  const _getVendorName = (vendor: string) => {
    switch (vendor) {
      case 'gmail':
        return 'Gmail';
      case 'outlook':
        return 'Outlook';
      case 'smtp':
        return 'Custom SMTP';
      case 'resend':
        return 'Resend';
      default:
        return 'Other';
    }
  };

  return (
    <>
      <Dialog {...props}>
        <DialogContent className="p-0">
          {/* Header */}
          <div className="border-b border-border flex items-start justify-between px-4 py-6">
            <DialogHeader className="space-y-1">
              <DialogTitle>Email Integration</DialogTitle>
            </DialogHeader>
          </div>

          {/* Content */}
          <div className="px-4 py-2 space-y-2">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-32 bg-secondary/20 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : providers && providers.length > 0 ? (
              <div className="space-y-3">
                {providers.map((provider) => (
                  <div
                    key={provider._id}
                    className="bg-card border border-border rounded-lg p-4"
                  >
                    {/* Header Row */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {getVendorIcon(provider.vendor)}
                        <h3 className="font-medium text-base text-foreground">
                          {provider.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0"
                            >
                              <span className="sr-only">More options</span>
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleTestConnection(provider._id)}
                              disabled={testingProviderId === provider._id}
                            >
                              <TestTube className="mr-2 size-4" />
                              {testingProviderId === provider._id
                                ? 'Testing...'
                                : 'Test'}
                            </DropdownMenuItem>
                            {!provider.isDefault && (
                              <DropdownMenuItem
                                onClick={() => handleSetDefault(provider._id)}
                              >
                                <Star className="mr-2 size-4" />
                                Set as Default
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => handleDeleteProvider(provider._id)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="mr-2 size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {/* Badges Row */}
                    <div className="flex items-center gap-2 mb-3">
                      {provider.isDefault && (
                        <Badge
                          variant="orange"
                          className="[&>span]:flex [&>span]:items-center"
                        >
                          <Star className="size-3.5 mr-1" />
                          Default
                        </Badge>
                      )}
                      {provider.authMethod === 'oauth2' && (
                        <Badge variant="blue">OAuth2</Badge>
                      )}
                      {provider.sendMethod === 'api' && (
                        <Badge variant="blue">API Sending</Badge>
                      )}
                    </div>

                    {/* Technical Details */}
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {provider.authMethod === 'oauth2' &&
                        provider.metadata?.oauth2_user && (
                          <div>
                            <span className="font-medium">Account:</span>{' '}
                            {provider.metadata.oauth2_user as string}
                          </div>
                        )}
                      {provider.sendMethod && (
                        <div>
                          <span className="font-medium">Send Method:</span>{' '}
                          {provider.sendMethod === 'api'
                            ? 'API (Gmail/Graph)'
                            : 'SMTP'}
                        </div>
                      )}
                      {provider.smtpConfig && (
                        <div>
                          <span className="font-medium">SMTP:</span>{' '}
                          {provider.smtpConfig.host}:{provider.smtpConfig.port}{' '}
                          ({provider.smtpConfig.secure ? 'SSL' : 'TLS'})
                        </div>
                      )}
                      {provider.imapConfig && (
                        <div>
                          <span className="font-medium">IMAP:</span>{' '}
                          {provider.imapConfig.host}:{provider.imapConfig.port}{' '}
                          ({provider.imapConfig.secure ? 'SSL' : 'TLS'})
                        </div>
                      )}
                      {provider.passwordAuth && (
                        <div>
                          <span className="font-medium">User:</span>{' '}
                          {provider.passwordAuth.user}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Mail className="size-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground mb-2">
                  No email providers configured yet
                </p>
                <p className="text-xs text-muted-foreground">
                  Add Gmail, Outlook, or a custom SMTP provider to get started
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border p-4">
            <Button onClick={handleAddProvider} className="w-full">
              <Plus className="size-4 mr-2" />
              Add Email Provider
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Provider Type Selector */}
      <EmailProviderTypeSelector
        open={showTypeSelector}
        onOpenChange={setShowTypeSelector}
        organizationId={organizationId}
        onSuccess={() => {
          setShowTypeSelector(false);
        }}
      />
    </>
  );
}
