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
import { GmailIcon } from '@/components/ui/icons';
import { DialogProps } from '@radix-ui/react-dialog';
import {
  Plus,
  Trash2,
  MoreVertical,
  TestTube,
  Star,
  Shield,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import GmailCreateProviderDialog from './gmail-create-provider-dialog';
import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useDateFormat } from '@/hooks/use-date-format';

interface GmailIntegrationDialogProps extends DialogProps {
  organizationId: string;
}

export default function GmailIntegrationDialog({
  organizationId,
  ...props
}: GmailIntegrationDialogProps) {
  const { formatDate } = useDateFormat();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );

  // Fetch Gmail providers using Convex
  const allProviders = useQuery(
    api.email_providers.list,
    organizationId ? { organizationId: organizationId as string } : 'skip',
  );

  // Filter for Gmail providers only
  const providers = allProviders?.filter((p) => p.vendor === 'gmail') || [];
  const isLoading = allProviders === undefined;

  const deleteProvider = useMutation(api.email_providers.deleteProvider);
  const testExistingProvider = useAction(
    api.email_providers.testExistingProvider,
  );
  const generateAuthUrl = useAction(api.email_providers.generateOAuth2AuthUrl);

  const handleCreateProvider = () => {
    setShowCreateModal(true);
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
          description: `All tests passed! SMTP: ${result.smtp.latencyMs}ms, IMAP: ${result.imap.latencyMs}ms`,
          variant: 'success',
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

  const handleAuthorize = async (providerId: string) => {
    try {
      // Pass the current origin to preserve the hostname (localhost vs 127.0.0.1)
      const redirectUri = `${window.location.origin}/api/auth/oauth2/callback`;
      const authUrl = await generateAuthUrl({
        emailProviderId: providerId as Id<'emailProviders'>,
        organizationId: organizationId as string,
        redirectUri,
      });

      // Redirect to OAuth2 authorization
      window.location.href = authUrl;
    } catch (error) {
      console.error('Failed to generate auth URL:', error);
      toast({
        title: 'Failed to start authorization',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent className="p-0">
        {/* Header */}
        <div className="border-b border-border flex items-start justify-between px-4 py-6">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-3">
              <DialogTitle>Gmail integration</DialogTitle>
            </div>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-4 py-2 space-y-2">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 bg-secondary/20 rounded-lg animate-pulse"
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
                    <h3 className="font-medium text-base text-foreground mb-1">
                      {provider.name}
                    </h3>
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
                          {provider.authMethod === 'oauth2' &&
                            !provider.oauth2Auth?.accessTokenEncrypted && (
                              <DropdownMenuItem
                                onClick={() => handleAuthorize(provider._id)}
                                className="text-blue-600 focus:text-blue-600"
                              >
                                <Shield className="mr-2 size-4" />
                                Authorize
                              </DropdownMenuItem>
                            )}
                          <DropdownMenuItem
                            onClick={() => handleTestConnection(provider._id)}
                            disabled={
                              testingProviderId === provider._id ||
                              (provider.authMethod === 'oauth2' &&
                                !provider.oauth2Auth?.accessTokenEncrypted)
                            }
                          >
                            <TestTube className="mr-2 size-4" />
                            {testingProviderId === provider._id
                              ? 'Testing...'
                              : 'Test'}
                          </DropdownMenuItem>
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
                    {provider.authMethod === 'oauth2' ? (
                      <>
                        <Badge variant="outline" className="text-xs">
                          OAuth2
                        </Badge>
                        {!provider.oauth2Auth?.accessTokenEncrypted && (
                          <Badge variant="destructive" className="text-xs">
                            Not Authorized
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Password
                      </Badge>
                    )}
                    {provider.smtpConfig && (
                      <Badge variant="outline" className="text-xs">
                        SMTP
                      </Badge>
                    )}
                    {provider.imapConfig && (
                      <Badge variant="outline" className="text-xs">
                        IMAP
                      </Badge>
                    )}
                  </div>

                  {/* Technical Details */}
                  <div className="space-y-1 mb-3 text-xs text-muted-foreground">
                    {provider.smtpConfig && (
                      <div>
                        SMTP: {provider.smtpConfig.host}:
                        {provider.smtpConfig.port} (
                        {provider.smtpConfig.secure ? 'SSL' : 'TLS'})
                      </div>
                    )}
                    {provider.imapConfig && (
                      <div>
                        IMAP: {provider.imapConfig.host}:
                        {provider.imapConfig.port} (
                        {provider.imapConfig.secure ? 'SSL' : 'TLS'})
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Created:{' '}
                      {formatDate(new Date(provider._creationTime), 'short')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <GmailIcon className="size-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted-foreground mb-2">
                No Gmail providers configured yet
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4">
          <Button onClick={handleCreateProvider} className="w-full">
            <Plus className="size-4 mr-2" />
            Add Gmail provider
          </Button>
        </div>

        {/* Create Provider Modal */}
        <GmailCreateProviderDialog
          open={showCreateModal}
          onOpenChange={setShowCreateModal}
          organizationId={organizationId}
          onSuccess={() => {
            setShowCreateModal(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
