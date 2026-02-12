'use client';

import { Settings, Mail, Plus, Puzzle } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';
import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { Image } from '@/app/components/ui/data-display/image';
import { Switch } from '@/app/components/ui/forms/switch';
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription,
} from '@/app/components/ui/layout/card';
import { Stack, HStack, Grid, Center } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import { EmailIntegrationDialog } from './email-integration-dialog';
import { IntegrationManageDialog } from './integration-manage-dialog';
import { IntegrationUploadDialog } from './integration-upload/integration-upload-dialog';
import { OAuth2Banner } from './oauth2-banner';
import { SSOCard } from './sso-card';

type Integration = Doc<'integrations'> & { iconUrl?: string | null };
type EmailProvider = Doc<'emailProviders'>;

interface IntegrationsClientProps {
  organizationId: string;
  integrations: Integration[];
  emailProviders: EmailProvider[];
  ssoProvider: SsoProvider | null;
  tab?: string;
}

export function IntegrationsClient({
  organizationId,
  integrations,
  emailProviders,
  ssoProvider,
  tab,
}: IntegrationsClientProps) {
  const { t } = useT('settings');

  const emailProviderCount = emailProviders?.length || 0;

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(tab === 'email');
  useEffect(() => {
    setEmailDialogOpen(tab === 'email');
  }, [tab]);
  const [managingIntegration, setManagingIntegration] =
    useState<Integration | null>(null);

  return (
    <Stack>
      <OAuth2Banner />

      <Grid cols={1} md={2} lg={3}>
        <SSOCard organizationId={organizationId} ssoProvider={ssoProvider} />

        {/* Email integration card */}
        <Card className="flex flex-col justify-between">
          <CardContent className="p-5">
            <Stack gap={3}>
              <Center className="border-border h-11 w-11 rounded-md border">
                <Mail className="size-6" />
              </Center>
              <Stack gap={1}>
                <CardTitle className="text-base">
                  {t('integrations.email.name')}
                </CardTitle>
                <CardDescription>
                  {t('integrations.email.description')}
                </CardDescription>
              </Stack>
            </Stack>
          </CardContent>
          <CardFooter className="border-border border-t px-5 py-4">
            <HStack justify="between" className="w-full">
              <Button
                variant="link"
                size="sm"
                onClick={() => setEmailDialogOpen(true)}
                className="flex h-6 items-center gap-1 text-sm"
              >
                <Settings className="size-4" />
                {t('integrations.manage')}
              </Button>
              <Switch
                checked={emailProviderCount > 0}
                onCheckedChange={() => setEmailDialogOpen(true)}
              />
            </HStack>
          </CardFooter>
        </Card>

        {/* Dynamic integration cards from DB */}
        {integrations.map((integration) => (
          <Card key={integration._id} className="flex flex-col justify-between">
            <CardContent className="p-5">
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
                    <CardTitle className="text-base">
                      {integration.title}
                    </CardTitle>
                  </HStack>
                  <CardDescription>
                    {integration.description ?? integration.name}
                  </CardDescription>
                </Stack>
              </Stack>
            </CardContent>
            <CardFooter className="border-border border-t px-5 py-4">
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
            </CardFooter>
          </Card>
        ))}

        {/* Upload integration card */}
        <button
          type="button"
          className="text-left"
          onClick={() => setUploadDialogOpen(true)}
        >
          <Card className="border-border hover:border-primary/50 flex cursor-pointer flex-col justify-between border-dashed transition-colors">
            <CardContent className="p-5">
              <Stack gap={3}>
                <Center className="border-border h-11 w-11 rounded-md border border-dashed">
                  <Plus className="text-muted-foreground size-6" />
                </Center>
                <Stack gap={1}>
                  <CardTitle className="text-base">
                    {t('integrations.upload.addIntegration')}
                  </CardTitle>
                  <CardDescription>
                    {t('integrations.upload.addDescription')}
                  </CardDescription>
                </Stack>
              </Stack>
            </CardContent>
            <CardFooter className="border-border border-t px-5 py-4">
              <span className="text-primary flex h-6 items-center gap-1 text-sm font-medium">
                <Plus className="size-4" />
                {t('integrations.upload.uploadPackage')}
              </span>
            </CardFooter>
          </Card>
        </button>
      </Grid>

      {/* Upload dialog */}
      <IntegrationUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        organizationId={organizationId}
      />

      {/* Email dialog */}
      <EmailIntegrationDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        organizationId={organizationId}
        ssoProvider={ssoProvider}
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
