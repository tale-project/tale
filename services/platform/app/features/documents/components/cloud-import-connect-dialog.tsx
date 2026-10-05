'use client';

import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, type RefObject } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

import type { CloudImportInterruption } from '../lib/cloud-import-outcome';
import { GoogleReauthButton } from './google-reauth-button';
import { MicrosoftReauthButton } from './microsoft-reauth-button';

export type CloudImportConnectProvider = 'onedrive' | 'google-drive';

/** The provider as the copy names it — the import menu's own entries. */
const PROVIDER_LABEL: Record<CloudImportConnectProvider, string> = {
  onedrive: 'Microsoft 365',
  'google-drive': 'Google Drive',
};

interface CloudImportConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  provider: CloudImportConnectProvider;
  /** Access ended while an import ran: the dialog says so, and how many
   *  files came in before it, instead of asking for a first connection. */
  interruption?: CloudImportInterruption;
}

/**
 * Compact grant prompt for Documents cloud import — same measure as
 * From your device / New folder. Kept separate from the wide picker so
 * authorizing never resizes an open dialog.
 */
export function CloudImportConnectDialog({
  open,
  onOpenChange,
  restoreFocusRef,
  provider,
  interruption,
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
  const { refetch: refetchAppStatus } = appStatus;
  // A check that failed is not an app that is missing (#3864): the dialog
  // names the failure and runs the check again, and Connect waits until the
  // answer is in — before it, consenting could still end on that error page.
  const appRead = readStateOf(appStatus);
  const appKnown = appStatus.data !== undefined;
  const retryAppStatus = useCallback(() => {
    void refetchAppStatus();
  }, [refetchAppStatus]);
  // A check that works on retry takes the alert away; a focused Try again
  // hands its focus to the words that replace it, not to the page.
  const guidanceRef = useRef<HTMLDivElement>(null);
  const focusGuidance = useCallback(() => {
    guidanceRef.current?.focus();
  }, []);

  const interrupted = interruption !== undefined;
  const title =
    provider === 'onedrive'
      ? interrupted
        ? t('onedrive.reconnect')
        : t('onedrive.microsoftNotConnected')
      : interrupted
        ? t('googledrive.reconnect')
        : t('googledrive.notConnected');
  // After an interrupted import the way on is the same selection again,
  // which skips the files already in; a first connection just connects.
  const guidance = interrupted
    ? t('cloudImport.reconnectToImportRest')
    : provider === 'onedrive'
      ? t('onedrive.microsoftNotConnectedDescription')
      : t('googledrive.notConnectedDescription');
  // Reconnecting a grant that ended, in the sync dialog's words and button.
  const reauthError = interrupted ? 'RefreshTokenError' : undefined;

  const appMissing = appStatus.data?.configured === false;
  const isAdmin = ability.can('write', 'orgSettings');

  return (
    <Dialog
      restoreFocusRef={restoreFocusRef}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      // What happened is the dialog's description, read out with its title
      // when it opens.
      description={
        interruption === undefined
          ? undefined
          : t('cloudImport.importInterrupted', {
              provider: PROVIDER_LABEL[provider],
              imported: interruption.imported,
              total: interruption.total,
            })
      }
      size="md"
    >
      <Stack gap={4} className="pt-1">
        {appRead.unavailable ? (
          <CatalogLoadError
            // Each failure is announced again; Try again keeps its node, and
            // the focus on it, through a retry that fails again.
            failureKey={appRead.failureCount}
            onFocusLost={focusGuidance}
            message={t('cloudImport.appStatusLoadFailed', {
              provider: PROVIDER_LABEL[provider],
            })}
            onRetry={retryAppStatus}
            isRetrying={appRead.retrying}
          />
        ) : (
          <Text
            as="div"
            variant="muted"
            ref={guidanceRef}
            tabIndex={-1}
            className="outline-none"
          >
            {appMissing
              ? isAdmin
                ? t('cloudImport.appNotConfiguredAdmin')
                : t('cloudImport.appNotConfigured')
              : guidance}
          </Text>
        )}
        {!appRead.unavailable && !appMissing && (
          <div>
            {provider === 'onedrive' ? (
              <MicrosoftReauthButton error={reauthError} disabled={!appKnown} />
            ) : (
              <GoogleReauthButton error={reauthError} disabled={!appKnown} />
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
