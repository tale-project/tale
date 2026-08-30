'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useAbility } from '@/app/hooks/use-ability';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

import { GoogleReauthButton } from './google-reauth-button';
import { MicrosoftReauthButton } from './microsoft-reauth-button';

export type CloudImportConnectProvider = 'onedrive' | 'google-drive';

interface CloudImportConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: CloudImportConnectProvider;
}

/**
 * Compact grant prompt for Documents cloud import — same measure as
 * From your device / New folder. Kept separate from the wide picker so
 * authorizing never resizes an open dialog.
 */
export function CloudImportConnectDialog({
  open,
  onOpenChange,
  provider,
}: CloudImportConnectDialogProps) {
  const { t } = useT('documents');
  const ability = useAbility();
  const navigate = useNavigate();
  const organizationId = useOrganizationId();
  // Whether there is an OAuth app to consent against (org row or deployment
  // env) — without one, Connect would land on the not-configured error page,
  // so the dialog says what is missing instead.
  const appStatus = useBackendQuery(
    'cloud_import/queries:getOauthAppStatus',
    organizationId ? { organizationId, provider } : 'skip',
  );

  const title =
    provider === 'onedrive'
      ? t('onedrive.microsoftNotConnected')
      : t('googledrive.notConnected');
  const description =
    provider === 'onedrive'
      ? t('onedrive.microsoftNotConnectedDescription')
      : t('googledrive.notConnectedDescription');

  const appMissing = appStatus.data !== undefined && !appStatus.data.configured;
  const isAdmin = ability.can('write', 'orgSettings');

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} size="md">
      <Stack gap={4} className="pt-1">
        <Text as="div" variant="muted">
          {appMissing
            ? isAdmin
              ? t('cloudImport.appNotConfiguredAdmin')
              : t('cloudImport.appNotConfigured')
            : description}
        </Text>
        {!appMissing && (
          <div>
            {provider === 'onedrive' ? (
              <MicrosoftReauthButton />
            ) : (
              <GoogleReauthButton />
            )}
          </div>
        )}
        {appMissing && isAdmin && organizationId && (
          <div>
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                void navigate({
                  to: '/dashboard/$id/settings/connectors',
                  params: { id: organizationId },
                });
              }}
            >
              {t('cloudImport.openConnectorSettings')}
            </Button>
          </div>
        )}
      </Stack>
    </Dialog>
  );
}
