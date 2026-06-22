'use client';

import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  type Integration,
  useIntegrationManage,
} from '../../hooks/use-integration-manage';
import { IntegrationCredentialsFormConnected } from './integration-credentials-form-connected';

const noop = () => {};

interface ConnectIntegrationPanelProps {
  integration: Integration;
  organizationId: string;
  /** Fired once when the integration becomes connected (active). */
  onConnected: () => void;
  /**
   * Wizard hook for OAuth integrations: instead of the full-page reauthorize
   * redirect (which would tear down an inline dialog), the caller opens the
   * provided URL builder in a popup. Omit to keep the settings-page redirect.
   */
  onOAuthAuthorize?: (prepareUrl: () => Promise<string | null>) => void;
}

/**
 * Self-contained "connect one integration" panel: the credential form plus a
 * single connect/authorize button, wired to its own `useIntegrationManage`. This
 * is the reusable building block the app-install wizard drops into a step — it
 * reuses the exact form + connect flow from Settings → Integrations (including
 * `handleTestConnection`, which lazily installs the credential stub and flips it
 * active on a successful test), so credential handling never diverges.
 */
export function ConnectIntegrationPanel({
  integration,
  organizationId,
  onConnected,
  onOAuthAuthorize,
}: ConnectIntegrationPanelProps) {
  const { t } = useT('settings');
  const manage = useIntegrationManage(integration, noop, true, organizationId);

  // Connected = a successful inline test, OR (OAuth) the reactive credential
  // flipping active server-side after the popup callback (`manage.isActive`
  // tracks the passed integration's reactive `isActive`). Fire `onConnected`
  // exactly once so the wizard advances on either path.
  const connected =
    manage.testResult?.success === true || manage.isActive === true;
  const firedRef = useRef(false);
  useEffect(() => {
    if (connected && !firedRef.current) {
      firedRef.current = true;
      onConnected();
    }
  }, [connected, onConnected]);

  // OAuth integrations whose client credentials are already saved need an
  // authorize round-trip (not an inline key test). Until the client creds are
  // saved (via the form's own Save button) this is false and the primary action
  // stays the inline test.
  const isOAuthAuthorize =
    manage.selectedAuthMethod === 'oauth2' &&
    manage.hasOAuth2Config &&
    manage.hasOAuth2Credentials;

  const onConnectClick = () => {
    if (isOAuthAuthorize) {
      if (onOAuthAuthorize) onOAuthAuthorize(manage.prepareOAuth2Url);
      else void manage.handleReauthorize();
    } else {
      void manage.handleTestConnection();
    }
  };

  const connectDisabled =
    manage.busy || (isOAuthAuthorize ? false : !manage.hasChanges);
  const isBusy = manage.isTesting || manage.isSavingOAuth2;

  return (
    <div className="flex flex-col gap-4">
      <IntegrationCredentialsFormConnected
        integration={integration}
        manage={manage}
      />
      <HStack justify="end" align="center">
        <Button onClick={onConnectClick} disabled={connectDisabled}>
          {isBusy ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t('integrations.manageDialog.connecting')}
            </>
          ) : (
            t('integrations.panel.connectName', { name: integration.title })
          )}
        </Button>
      </HStack>
    </div>
  );
}
