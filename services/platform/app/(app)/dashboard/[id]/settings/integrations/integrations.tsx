'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ShopifyIcon, CirculyIcon } from '@/components/ui/icons';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Settings, Mail, Loader2 } from 'lucide-react';
import {
  useMutation,
  useAction,
  usePreloadedQuery,
  type Preloaded,
} from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toast } from '@/hooks/use-toast';
import { OAuth2Banner } from '@/components/oauth2-banner';
import { useT } from '@/lib/i18n';

// Dynamically import dialog components to reduce initial bundle size
const ShopifyIntegrationDialog = dynamic(
  () => import('./components/shopify-integration-dialog'),
  {
    ssr: false,
  },
);

const CirculyIntegrationDialog = dynamic(
  () => import('./components/circuly-integration-dialog'),
  {
    ssr: false,
  },
);

const CirculyDisconnectConfirmationDialog = dynamic(
  () => import('./components/circuly-disconnect-confirmation-dialog'),
  {
    ssr: false,
  },
);

const ShopifyDisconnectConfirmationDialog = dynamic(
  () => import('./components/shopify-disconnect-confirmation-dialog'),
  {
    ssr: false,
  },
);

const EmailIntegrationDialog = dynamic(
  () => import('./components/email-integration-dialog'),
  {
    ssr: false,
  },
);

interface IntegrationsProps {
  organizationId: string;
  preloadedShopify: Preloaded<typeof api.integrations.getByName>;
  preloadedCirculy: Preloaded<typeof api.integrations.getByName>;
  preloadedEmailProviders: Preloaded<typeof api.email_providers.list>;
}

export default function Integrations({
  organizationId,
  preloadedShopify,
  preloadedCirculy,
  preloadedEmailProviders,
}: IntegrationsProps) {
  const { t } = useT('settings');
  const searchParams = useSearchParams();

  // Integration definitions with translations
  const integrations = [
    {
      id: 'shopify',
      name: 'Shopify',
      description: t('integrations.shopify.description'),
      icon: ShopifyIcon,
    },
    {
      id: 'circuly',
      name: 'Circuly',
      description: t('integrations.circuly.description'),
      icon: CirculyIcon,
    },
    {
      id: 'email',
      name: t('integrations.email.name'),
      description: t('integrations.email.description'),
      icon: Mail,
    },
  ];

  // Use preloaded queries for SSR + real-time reactivity
  const shopifyIntegration = usePreloadedQuery(preloadedShopify);
  const circulyIntegration = usePreloadedQuery(preloadedCirculy);
  const emailProviders = usePreloadedQuery(preloadedEmailProviders);
  const emailProviderCount = emailProviders?.length || 0;

  // Mutations and Actions
  const createIntegration = useAction(api.integrations.create);
  const updateIntegration = useAction(api.integrations.update);
  const testConnection = useAction(api.integrations.testConnection);
  const deleteIntegrationMutation = useMutation(
    api.integrations.deleteIntegration,
  );

  // Modal states
  const [shopifyModalOpen, setShopifyModalOpen] = useState(false);
  const [shopifyDisconnectModalOpen, setShopifyDisconnectModalOpen] =
    useState(false);
  const [circulyModalOpen, setCirculyModalOpen] = useState(false);
  const [circulyDisconnectModalOpen, setCirculyDisconnectModalOpen] =
    useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  // Handle URL parameter to open specific integration dialog
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'shopify') {
      setShopifyModalOpen(true);
    } else if (tab === 'circuly') {
      setCirculyModalOpen(true);
    } else if (tab === 'email') {
      setEmailModalOpen(true);
    }
  }, [searchParams]);

  const handleSwitchToggle = (integrationId: string, checked: boolean) => {
    switch (integrationId) {
      case 'shopify':
        if (checked) {
          setShopifyModalOpen(true);
        } else {
          setShopifyDisconnectModalOpen(true);
        }
        break;
      case 'circuly':
        if (checked) {
          setCirculyModalOpen(true);
        } else {
          setCirculyDisconnectModalOpen(true);
        }
        break;
      case 'email':
        setEmailModalOpen(true);
        break;
    }
  };

  const handleManageClick = (integrationId: string) => {
    switch (integrationId) {
      case 'email':
        setEmailModalOpen(true);
        break;
    }
  };

  const handleShopifyConnect = async (data: {
    domain: string;
    accessToken: string;
  }) => {
    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    try {
      let integrationId: Id<'integrations'>;

      if (shopifyIntegration) {
        // Update existing integration
        await updateIntegration({
          integrationId: shopifyIntegration._id,
          apiKeyAuth: {
            key: data.accessToken,
          },
          connectionConfig: {
            domain: data.domain,
          },
          status: 'testing',
          isActive: false,
        });
        integrationId = shopifyIntegration._id;
      } else {
        // Create new integration
        const payload = {
          organizationId: organizationId,
          name: 'shopify',
          title: 'Shopify',
          authMethod: 'api_key' as const,
          apiKeyAuth: {
            key: data.accessToken,
          },
          connectionConfig: {
            domain: data.domain,
          },
        };
        integrationId = await createIntegration(payload);
      }

      // Test the connection
      const testResult = await testConnection({ integrationId });
      if (!testResult.success) {
        throw new Error(testResult.message);
      }
    } catch (error) {
      throw error; // Re-throw to let dialog handle the error
    }
  };

  const handleShopifyDisconnect = async () => {
    if (!shopifyIntegration) return;

    try {
      await deleteIntegrationMutation({
        integrationId: shopifyIntegration._id,
      });
      setShopifyDisconnectModalOpen(false);
    } catch (error) {
      toast({
        title: t('integrations.toast.disconnectFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.shopify.disconnectError'),
        variant: 'destructive',
      });
      throw error;
    }
  };

  const handleCirculyConnect = async (data: {
    username: string;
    password: string;
  }) => {
    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    try {
      if (circulyIntegration) {
        // Update existing integration
        await updateIntegration({
          integrationId: circulyIntegration._id,
          basicAuth: {
            username: data.username,
            password: data.password,
          },
          status: 'active',
          isActive: true,
        });
      } else {
        // Create new integration
        const payload = {
          organizationId: organizationId,
          name: 'circuly',
          title: 'Circuly',
          authMethod: 'basic_auth' as const,
          basicAuth: {
            username: data.username,
            password: data.password,
          },
        };
        console.log('Creating Circuly integration with payload:', payload);
        await createIntegration(payload);
      }
    } catch (error) {
      throw error; // Re-throw to let dialog handle the error
    }
  };

  const handleCirculyDisconnect = async () => {
    if (!circulyIntegration) return;

    try {
      await deleteIntegrationMutation({
        integrationId: circulyIntegration._id,
      });
      toast({
        title: t('integrations.toast.disconnected'),
        description: t('integrations.circuly.disconnectedDescription'),
      });
      setCirculyDisconnectModalOpen(false);
    } catch (error) {
      toast({
        title: t('integrations.toast.disconnectFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.circuly.disconnectError'),
        variant: 'destructive',
      });
      throw error;
    }
  };

  // Show loading while data is loading
  if (shopifyIntegration === undefined || circulyIntegration === undefined) {
    return (
      <div className="flex items-center justify-center">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* OAuth2 Banner Notifications */}
      <OAuth2Banner />

      {/* Integrations Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {integrations.map((integration) => {
          const IconComponent = integration.icon;
          return (
            <div
              key={integration.id}
              className="bg-background rounded-xl border border-border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex flex-col justify-between"
            >
              {/* Main content area */}
              <div className="p-5">
                <div className="flex flex-col gap-3">
                  <div className="w-11 h-11 bg-background border border-border rounded-md flex items-center justify-center">
                    <IconComponent className="size-6" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-base tracking-[-0.24px]">
                        {integration.name}
                      </h3>
                      {/* Show provider count for email integrations - disabled until Convex integration is implemented */}
                    </div>
                    <p className="text-sm tracking-[-0.21px] leading-normal text-muted-foreground">
                      {integration.description}
                    </p>
                  </div>
                </div>
              </div>

              {/* Footer with manage button and switch */}
              <div className="border-t border-border px-5 py-4 flex items-center justify-between">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    if (integration.id === 'circuly') {
                      setCirculyModalOpen(true);
                    } else if (integration.id === 'shopify') {
                      setShopifyModalOpen(true);
                    } else {
                      handleManageClick(integration.id);
                    }
                  }}
                  className="flex items-center gap-1 text-sm h-6"
                >
                  <Settings className="size-4" />
                  {t('integrations.manage')}
                </Button>
                <Switch
                  checked={
                    (integration.id === 'circuly' &&
                      typeof circulyIntegration?._id === 'string') ||
                    (integration.id === 'shopify' &&
                      typeof shopifyIntegration?._id === 'string') ||
                    (integration.id === 'email' && emailProviderCount > 0) ||
                    false
                  }
                  onCheckedChange={(checked) => {
                    handleSwitchToggle(integration.id, checked);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Integration Modals */}
      <ShopifyIntegrationDialog
        open={shopifyModalOpen}
        onOpenChange={setShopifyModalOpen}
        onConnect={handleShopifyConnect}
        onDisconnect={() => setShopifyDisconnectModalOpen(true)}
        credentials={
          shopifyIntegration
            ? {
                domain: shopifyIntegration.connectionConfig?.domain,
              }
            : null
        }
      />

      <CirculyIntegrationDialog
        open={circulyModalOpen}
        onOpenChange={setCirculyModalOpen}
        credentials={
          circulyIntegration
            ? {
                username: circulyIntegration.basicAuth?.username,
              }
            : null
        }
        onConnect={handleCirculyConnect}
        onDisconnect={() => setCirculyDisconnectModalOpen(true)}
      />

      <ShopifyDisconnectConfirmationDialog
        open={shopifyDisconnectModalOpen}
        onOpenChange={setShopifyDisconnectModalOpen}
        domain={shopifyIntegration?.connectionConfig?.domain || ''}
        onConfirm={handleShopifyDisconnect}
      />

      <CirculyDisconnectConfirmationDialog
        open={circulyDisconnectModalOpen}
        onOpenChange={setCirculyDisconnectModalOpen}
        username={circulyIntegration?.basicAuth?.username || ''}
        onConfirm={handleCirculyDisconnect}
      />

      <EmailIntegrationDialog
        open={emailModalOpen}
        onOpenChange={setEmailModalOpen}
        organizationId={organizationId}
      />
    </div>
  );
}
