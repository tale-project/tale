'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ShopifyIcon, CirculyIcon, ProtelIcon } from '@/components/icons';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardTitle, CardDescription } from '@/components/ui/card';
import { Stack, HStack, Grid, Center } from '@/components/ui/layout';
import { Settings, Mail, Loader2 } from 'lucide-react';
import { usePreloadedQuery, type Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toast } from '@/hooks/use-toast';
import { useCreateIntegration } from '../hooks/use-create-integration';
import { useUpdateIntegration } from '../hooks/use-update-integration';
import { useTestIntegration } from '../hooks/use-test-integration';
import { useDeleteIntegration } from '../hooks/use-delete-integration';
import { OAuth2Banner } from './oauth2-banner';
import { useT } from '@/lib/i18n';

// Dynamically import dialog components to reduce initial bundle size
const ShopifyIntegrationDialog = dynamic(
  () => import('./shopify-integration-dialog').then(mod => ({ default: mod.ShopifyIntegrationDialog })),
  {
    ssr: false,
  },
);

const CirculyIntegrationDialog = dynamic(
  () => import('./circuly-integration-dialog').then(mod => ({ default: mod.CirculyIntegrationDialog })),
  {
    ssr: false,
  },
);

const CirculyDisconnectConfirmationDialog = dynamic(
  () => import('./circuly-disconnect-confirmation-dialog').then(mod => ({ default: mod.CirculyDisconnectConfirmationDialog })),
  {
    ssr: false,
  },
);

const ShopifyDisconnectConfirmationDialog = dynamic(
  () => import('./shopify-disconnect-confirmation-dialog').then(mod => ({ default: mod.ShopifyDisconnectConfirmationDialog })),
  {
    ssr: false,
  },
);

const EmailIntegrationDialog = dynamic(
  () => import('./email-integration-dialog').then(mod => ({ default: mod.EmailIntegrationDialog })),
  {
    ssr: false,
  },
);

const ProtelIntegrationDialog = dynamic(
  () => import('./protel-integration-dialog').then(mod => ({ default: mod.ProtelIntegrationDialog })),
  {
    ssr: false,
  },
);

const ProtelDisconnectConfirmationDialog = dynamic(
  () => import('./protel-disconnect-confirmation-dialog').then(mod => ({ default: mod.ProtelDisconnectConfirmationDialog })),
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

export function Integrations({
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

  // Dialog states
  const [shopifyDialogOpen, setShopifyDialogOpen] = useState(false);
  const [shopifyDisconnectDialogOpen, setShopifyDisconnectDialogOpen] =
    useState(false);
  const [circulyDialogOpen, setCirculyDialogOpen] = useState(false);
  const [circulyDisconnectDialogOpen, setCirculyDisconnectDialogOpen] =
    useState(false);
  const [protelDialogOpen, setProtelDialogOpen] = useState(false);
  const [protelDisconnectDialogOpen, setProtelDisconnectDialogOpen] =
    useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  // Handle URL parameter to open specific integration dialog
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'shopify') {
      setShopifyDialogOpen(true);
    } else if (tab === 'circuly') {
      setCirculyDialogOpen(true);
    } else if (tab === 'protel') {
      setProtelDialogOpen(true);
    } else if (tab === 'email') {
      setEmailDialogOpen(true);
    }
  }, [searchParams]);

  const handleSwitchToggle = (integrationId: string, checked: boolean) => {
    switch (integrationId) {
      case 'shopify':
        if (checked) {
          setShopifyDialogOpen(true);
        } else {
          setShopifyDisconnectDialogOpen(true);
        }
        break;
      case 'circuly':
        if (checked) {
          setCirculyDialogOpen(true);
        } else {
          setCirculyDisconnectDialogOpen(true);
        }
        break;
      case 'protel':
        if (checked) {
          setProtelDialogOpen(true);
        } else {
          setProtelDisconnectDialogOpen(true);
        }
        break;
      case 'email':
        setEmailDialogOpen(true);
        break;
    }
  };

  const handleManageClick = (integrationId: string) => {
    switch (integrationId) {
      case 'protel':
        setProtelDialogOpen(true);
        break;
      case 'email':
        setEmailDialogOpen(true);
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
      setShopifyDisconnectDialogOpen(false);
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
      setCirculyDisconnectDialogOpen(false);
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
      setProtelDisconnectDialogOpen(false);
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
                        setCirculyDialogOpen(true);
                      } else if (integration.id === 'shopify') {
                        setShopifyDialogOpen(true);
                      } else if (integration.id === 'protel') {
                        setProtelDialogOpen(true);
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

      {/* Integration Dialogs */}
      <ShopifyIntegrationDialog
        open={shopifyDialogOpen}
        onOpenChange={setShopifyDialogOpen}
        onConnect={handleShopifyConnect}
        onDisconnect={() => setShopifyDisconnectDialogOpen(true)}
        credentials={
          shopifyIntegration
            ? {
              domain: shopifyIntegration.connectionConfig?.domain,
            }
            : null
        }
      />

      <CirculyIntegrationDialog
        open={circulyDialogOpen}
        onOpenChange={setCirculyDialogOpen}
        credentials={
          circulyIntegration
            ? {
              username: circulyIntegration.basicAuth?.username,
            }
            : null
        }
        onConnect={handleCirculyConnect}
        onDisconnect={() => setCirculyDisconnectDialogOpen(true)}
      />

      <ShopifyDisconnectConfirmationDialog
        open={shopifyDisconnectDialogOpen}
        onOpenChange={setShopifyDisconnectDialogOpen}
        domain={shopifyIntegration?.connectionConfig?.domain || ''}
        onConfirm={handleShopifyDisconnect}
      />

      <CirculyDisconnectConfirmationDialog
        open={circulyDisconnectDialogOpen}
        onOpenChange={setCirculyDisconnectDialogOpen}
        username={circulyIntegration?.basicAuth?.username || ''}
        onConfirm={handleCirculyDisconnect}
      />

      <ProtelIntegrationDialog
        open={protelDialogOpen}
        onOpenChange={setProtelDialogOpen}
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
        onDisconnect={() => setProtelDisconnectDialogOpen(true)}
      />

      <ProtelDisconnectConfirmationDialog
        open={protelDisconnectDialogOpen}
        onOpenChange={setProtelDisconnectDialogOpen}
        server={protelIntegration?.sqlConnectionConfig?.server || ''}
        database={protelIntegration?.sqlConnectionConfig?.database || ''}
        onConfirm={handleProtelDisconnect}
      />

      <EmailIntegrationDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        organizationId={organizationId}
      />
    </Stack>
  );
}
