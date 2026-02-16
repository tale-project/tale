'use client';

import { Settings, Plus, Puzzle } from 'lucide-react';
import { useState } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';
import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { Image } from '@/app/components/ui/data-display/image';
import { Switch } from '@/app/components/ui/forms/switch';
import { Card } from '@/app/components/ui/layout/card';
import { Stack, HStack, Grid, Center } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import { IntegrationManageDialog } from './integration-manage-dialog';
import { IntegrationUploadDialog } from './integration-upload/integration-upload-dialog';
import { SSOCard } from './sso-card';

type Integration = Doc<'integrations'> & { iconUrl?: string | null };

interface IntegrationsClientProps {
  organizationId: string;
  integrations: Integration[];
  ssoProvider: SsoProvider | null;
}

export function IntegrationsClient({
  organizationId,
  integrations,
  ssoProvider,
}: IntegrationsClientProps) {
  const { t } = useT('settings');

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [managingIntegration, setManagingIntegration] =
    useState<Integration | null>(null);

  return (
    <Stack className="pb-8">
      <Grid cols={1} md={2} lg={3}>
        <SSOCard organizationId={organizationId} ssoProvider={ssoProvider} />

        {/* Dynamic integration cards from DB */}
        {integrations.map((integration) => (
          <Card
            key={integration._id}
            className="flex flex-col justify-between"
            contentClassName="p-5"
            footer={
              <HStack justify="between" className="w-full">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setManagingIntegration(integration)}
                  className="flex h-6 items-center gap-1 text-sm"
                >
                  <Settings className="size-4" />
                  {t('integrations.manage')}
                </Button>
                <Switch
                  checked={integration.isActive}
                  onCheckedChange={() => setManagingIntegration(integration)}
                />
              </HStack>
            }
            footerClassName="border-border border-t px-5 py-4"
          >
            <Stack gap={3}>
              <Center className="border-border h-11 w-11 rounded-md border">
                {integration.iconUrl ? (
                  <Image
                    src={integration.iconUrl}
                    alt={integration.title}
                    className="size-6 rounded object-contain"
                  />
                ) : (
                  <Puzzle className="size-6" />
                )}
              </Center>
              <Stack gap={1}>
                <HStack gap={2}>
                  <span className="text-base leading-none font-semibold tracking-tight">
                    {integration.title}
                  </span>
                </HStack>
                <p className="text-muted-foreground text-sm">
                  {integration.description ?? integration.name}
                </p>
              </Stack>
            </Stack>
          </Card>
        ))}

        {/* Upload integration card */}
        <button
          type="button"
          className="text-left"
          onClick={() => setUploadDialogOpen(true)}
        >
          <Card
            className="border-border hover:border-primary/50 flex cursor-pointer flex-col justify-between border-dashed transition-colors"
            contentClassName="p-5"
            footer={
              <span className="text-primary flex h-6 items-center gap-1 text-sm font-medium">
                <Plus className="size-4" />
                {t('integrations.upload.uploadPackage')}
              </span>
            }
            footerClassName="border-border border-t px-5 py-4"
          >
            <Stack gap={3}>
              <Center className="border-border h-11 w-11 rounded-md border border-dashed">
                <Plus className="text-muted-foreground size-6" />
              </Center>
              <Stack gap={1}>
                <span className="text-base leading-none font-semibold tracking-tight">
                  {t('integrations.upload.addIntegration')}
                </span>
                <p className="text-muted-foreground text-sm">
                  {t('integrations.upload.addDescription')}
                </p>
              </Stack>
            </Stack>
          </Card>
        </button>
      </Grid>

      {/* Upload dialog */}
      <IntegrationUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        organizationId={organizationId}
      />

      {/* Generic manage dialog for any uploaded integration */}
      {managingIntegration && (
        <IntegrationManageDialog
          open={!!managingIntegration}
          onOpenChange={(open) => {
            if (!open) setManagingIntegration(null);
          }}
          integration={managingIntegration}
        />
      )}
    </Stack>
  );
}
