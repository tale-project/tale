'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { Dialog } from '@/app/components/ui/dialog/dialog';
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

  const title =
    provider === 'onedrive'
      ? t('onedrive.microsoftNotConnected')
      : t('googledrive.notConnected');
  const description =
    provider === 'onedrive'
      ? t('onedrive.microsoftNotConnectedDescription')
      : t('googledrive.notConnectedDescription');

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} size="md">
      <Stack gap={4} className="pt-1">
        <Text as="div" variant="muted">
          {description}
        </Text>
        <div>
          {provider === 'onedrive' ? (
            <MicrosoftReauthButton />
          ) : (
            <GoogleReauthButton />
          )}
        </div>
      </Stack>
    </Dialog>
  );
}
