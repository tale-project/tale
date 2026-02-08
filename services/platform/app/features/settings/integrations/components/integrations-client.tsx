'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ShopifyIcon } from '@/app/components/icons/shopify-icon';
import { CirculyIcon } from '@/app/components/icons/circuly-icon';
import { ProtelIcon } from '@/app/components/icons/protel-icon';
import { Switch } from '@/app/components/ui/forms/switch';
import { Button } from '@/app/components/ui/primitives/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription,
} from '@/app/components/ui/layout/card';
import { Stack, HStack, Grid, Center } from '@/app/components/ui/layout/layout';
import { Settings, Mail } from 'lucide-react';
import type { Doc, Id } from '@/convex/_generated/dataModel';
import { toast } from '@/app/hooks/use-toast';
import { useCreateIntegration } from '../hooks/use-create-integration';
import { useUpdateIntegration } from '../hooks/use-update-integration';
import { useTestIntegration } from '../hooks/use-test-integration';
import { useDeleteIntegration } from '../hooks/use-delete-integration';
import { OAuth2Banner } from './oauth2-banner';
import { useT } from '@/lib/i18n/client';
import { ShopifyIntegrationDialog } from './shopify-integration-dialog';
import { CirculyIntegrationDialog } from './circuly-integration-dialog';
import { CirculyDisconnectConfirmationDialog } from './circuly-disconnect-confirmation-dialog';
import { ShopifyDisconnectConfirmationDialog } from './shopify-disconnect-confirmation-dialog';
import { EmailIntegrationDialog } from './email-integration-dialog';
import { ProtelIntegrationDialog } from './protel-integration-dialog';
import { ProtelDisconnectConfirmationDialog } from './protel-disconnect-confirmation-dialog';
import { SSOCard } from './sso-card';
import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

type Integration = Doc<'integrations'> | null;
type EmailProvider = Doc<'emailProviders'>;

interface IntegrationsClientProps {
  organizationId: string;
  shopify: Integration;
  circuly: Integration;
  protel: Integration;
  emailProviders: EmailProvider[];
  ssoProvider: SsoProvider | null;
  tab?: string;
}

export function IntegrationsClient({
  organizationId,
  shopify: shopifyIntegration,
  circuly: circulyIntegration,
  protel: protelIntegration,
  emailProviders,
  ssoProvider,
  tab,
}: IntegrationsClientProps) {
  const { t } = useT('settings');

  const integrations = useMemo(
    () => [
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
    ],
    [t],
  );

  const emailProviderCount = emailProviders?.length || 0;

  const createIntegration = useCreateIntegration();
  const updateIntegration = useUpdateIntegration();
  const testConnection = useTestIntegration();
  const deleteShopifyIntegration = useDeleteIntegration({
    integrationName: 'shopify',
  });
  const deleteCirculyIntegration = useDeleteIntegration({
    integrationName: 'circuly',
  });
  const deleteProtelIntegration = useDeleteIntegration({
    integrationName: 'protel',
  });

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

  useEffect(() => {
    if (tab === 'shopify') {
      setShopifyDialogOpen(true);
    } else if (tab === 'circuly') {
      setCirculyDialogOpen(true);
    } else if (tab === 'protel') {
      setProtelDialogOpen(true);
    } else if (tab === 'email') {
      setEmailDialogOpen(true);
    }
  }, [tab]);

  const handleSwitchToggle = useCallback(
    (integrationId: string, checked: boolean) => {
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
    },
    [],
  );

  const handleManageClick = useCallback((integrationId: string) => {
    switch (integrationId) {
      case 'protel':
        setProtelDialogOpen(true);
        break;
      case 'email':
        setEmailDialogOpen(true);
        break;
    }
  }, []);

  const handleShopifyConnect = async (data: {
    domain: string;
    accessToken: string;
  }) => {
    if (!organizationId) {
      throw new Error(t('integrations.errors.organizationRequired'));
    }

    let integrationId: Id<'integrations'>;

    if (shopifyIntegration) {
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

    const testResult = await testConnection({ integrationId });
    if (!testResult.success) {
      throw new Error(testResult.message);
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

    if (circulyIntegration) {
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
      await createIntegration(payload);
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
      throw new Error(t('integrations.errors.organizationRequired'));
    }

    if (protelIntegration) {
      await updateIntegration({
        integrationId: protelIntegration._id,
        basicAuth: {
          username: data.username,
          password: data.password,
        },
        sqlConnectionConfig: {
          engine: 'mssql',
          server: data.server,
          port: data.port,
          database: data.database,
        },
        status: 'active',
        isActive: true,
      });
    } else {
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

  return (
    <Stack>
      <OAuth2Banner />

      <Grid cols={1} md={2} lg={3}>
        <SSOCard
          organizationId={organizationId}
          ssoProvider={ssoProvider}
        />
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
                    <CardDescription>{integration.description}</CardDescription>
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
        ssoProvider={ssoProvider}
      />
    </Stack>
  );
}
