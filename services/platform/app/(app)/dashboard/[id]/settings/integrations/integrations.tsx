'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ShopifyIcon, CirculyIcon, ProtelIcon } from '@/components/ui/icons';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardTitle, CardDescription } from '@/components/ui/card';
import { Stack, HStack, Grid, Center } from '@/components/ui/layout';
import { Settings, Mail, Loader2 } from 'lucide-react';
import { usePreloadedQuery, type Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toast } from '@/hooks/use-toast';
import {
  useCreateIntegration,
  useUpdateIntegration,
  useTestIntegration,
  useDeleteIntegration,
} from './hooks';
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

const ProtelIntegrationDialog = dynamic(
  () => import('./components/protel-integration-dialog'),
  {
    ssr: false,
  },
);

const ProtelDisconnectConfirmationDialog = dynamic(
  () => import('./components/protel-disconnect-confirmation-dialog'),
  {
    ssr: false,
  },
);

interface IntegrationsProps {
  organizationId: string;
  preloadedShopify: Preloaded<typeof api.integrations.getByName>;
  preloadedCirculy: Preloaded<typeof api.integrations.getByName>;
  preloadedProtel: Preloaded<typeof api.integrations.getByName>;
  preloadedEmailProviders: Preloaded<typeof api.email_providers.list>;
}

export default function Integrations({
  organizationId,
  preloadedShopify,
  preloadedCirculy,
  preloadedProtel,
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
      id: 'protel',
      name: 'Protel PMS',
      description: t('integrations.protel.description'),
      icon: ProtelIcon,
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
  const protelIntegration = usePreloadedQuery(preloadedProtel);
  const emailProviders = usePreloadedQuery(preloadedEmailProviders);
  const emailProviderCount = emailProviders?.length || 0;

  // Mutations and Actions
  const createIntegration = useCreateIntegration();
  const updateIntegration = useUpdateIntegration();
  const testConnection = useTestIntegration();
  const deleteShopifyIntegration = useDeleteIntegration({ integrationName: 'shopify' });
  const deleteCirculyIntegration = useDeleteIntegration({ integrationName: 'circuly' });
  const deleteProtelIntegration = useDeleteIntegration({ integrationName: 'protel' });

  // Modal states
  const [shopifyModalOpen, setShopifyModalOpen] = useState(false);
  const [shopifyDisconnectModalOpen, setShopifyDisconnectModalOpen] =
    useState(false);
  const [circulyModalOpen, setCirculyModalOpen] = useState(false);
  const [circulyDisconnectModalOpen, setCirculyDisconnectModalOpen] =
    useState(false);
  const [protelModalOpen, setProtelModalOpen] = useState(false);
  const [protelDisconnectModalOpen, setProtelDisconnectModalOpen] =
    useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  // Handle URL parameter to open specific integration dialog
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'shopify') {
      setShopifyModalOpen(true);
    } else if (tab === 'circuly') {
      setCirculyModalOpen(true);
    } else if (tab === 'protel') {
      setProtelModalOpen(true);
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
      case 'protel':
        if (checked) {
          setProtelModalOpen(true);
        } else {
          setProtelDisconnectModalOpen(true);
        }
        break;
      case 'email':
        setEmailModalOpen(true);
        break;
    }
  };

  const handleManageClick = (integrationId: string) => {
    switch (integrationId) {
      case 'protel':
        setProtelModalOpen(true);
        break;
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
      throw new Error(t('integrations.errors.organizationRequired'));
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
          title: t('integrations.shopify.title'),
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
      await deleteShopifyIntegration({
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
      throw new Error(t('integrations.errors.organizationRequired'));
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
          title: t('integrations.circuly.title'),
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
      await deleteCirculyIntegration({
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

  const handleProtelConnect = async (data: {
    server: string;
    port: number;
    database: string;
    username: string;
    password: string;
  }) => {
    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    try {
      if (protelIntegration) {
        // Update existing integration - only credentials can be updated
        // To change connection config (server/port/database), disconnect and reconnect
        await updateIntegration({
          integrationId: protelIntegration._id,
          basicAuth: {
            username: data.username,
            password: data.password,
          },
          status: 'active',
          isActive: true,
        });
      } else {
        // Create new integration - SQL fields are auto-populated from predefined
        await createIntegration({
          organizationId: organizationId,
          name: 'protel',
          title: 'Protel PMS',
          authMethod: 'basic_auth' as const,
          basicAuth: {
            username: data.username,
            password: data.password,
          },
          type: 'sql',
          sqlConnectionConfig: {
            engine: 'mssql',
            server: data.server,
            port: data.port,
            database: data.database,
          },
        });
      }
    } catch (error) {
      throw error;
    }
  };

  const handleProtelDisconnect = async () => {
    if (!protelIntegration) return;

    try {
      await deleteProtelIntegration({
        integrationId: protelIntegration._id,
      });
      setProtelDisconnectModalOpen(false);
    } catch (error) {
      toast({
        title: t('integrations.toast.disconnectFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.protel.disconnectError'),
        variant: 'destructive',
      });
      throw error;
    }
  };

  // Show loading while data is loading
  if (
    shopifyIntegration === undefined ||
    circulyIntegration === undefined ||
    protelIntegration === undefined
  ) {
    return (
      <Center>
        <Loader2 className="size-4 animate-spin" />
      </Center>
    );
  }

  return (
    <Stack>
      <OAuth2Banner />

      <Grid cols={1} md={2} lg={3}>
        {integrations.map((integration) => {
          const IconComponent = integration.icon;
          return (
            <Card key={integration.id} className="flex flex-col justify-between">
              <CardContent className="p-5">
                <Stack gap={3}>
                  <Center className="w-11 h-11 border border-border rounded-md">
                    <IconComponent className="size-6" />
                  </Center>
                  <Stack gap={1}>
                    <HStack gap={2}>
                      <CardTitle className="text-base">
                        {integration.name}
                      </CardTitle>
                    </HStack>
                    <CardDescription>
                      {integration.description}
                    </CardDescription>
                  </Stack>
                </Stack>
              </CardContent>

              <CardFooter className="border-t border-border px-5 py-4">
                <HStack justify="between" className="w-full">
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      if (integration.id === 'circuly') {
                        setCirculyModalOpen(true);
                      } else if (integration.id === 'shopify') {
                        setShopifyModalOpen(true);
                      } else if (integration.id === 'protel') {
                        setProtelModalOpen(true);
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
                      (integration.id === 'protel' &&
                        typeof protelIntegration?._id === 'string') ||
                      (integration.id === 'email' && emailProviderCount > 0) ||
                      false
                    }
                    onCheckedChange={(checked) => {
                      handleSwitchToggle(integration.id, checked);
                    }}
                  />
                </HStack>
              </CardFooter>
            </Card>
          );
        })}
      </Grid>

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

      <ProtelIntegrationDialog
        open={protelModalOpen}
        onOpenChange={setProtelModalOpen}
        credentials={
          protelIntegration
            ? {
              server: protelIntegration.sqlConnectionConfig?.server,
              port: protelIntegration.sqlConnectionConfig?.port,
              database: protelIntegration.sqlConnectionConfig?.database,
              username: protelIntegration.basicAuth?.username,
            }
            : null
        }
        onConnect={handleProtelConnect}
        onDisconnect={() => setProtelDisconnectModalOpen(true)}
      />

      <ProtelDisconnectConfirmationDialog
        open={protelDisconnectModalOpen}
        onOpenChange={setProtelDisconnectModalOpen}
        server={protelIntegration?.sqlConnectionConfig?.server || ''}
        database={protelIntegration?.sqlConnectionConfig?.database || ''}
        onConfirm={handleProtelDisconnect}
      />

      <EmailIntegrationDialog
        open={emailModalOpen}
        onOpenChange={setEmailModalOpen}
        organizationId={organizationId}
      />
    </Stack>
  );
}
